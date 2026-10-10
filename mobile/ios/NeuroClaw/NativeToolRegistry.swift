import Contacts
import CoreLocation
import Photos
import EventKit
import Foundation
import UIKit
import UserNotifications

/// Callable native tools exposed to the authenticated AgentBridge.
/// Each tool uses public iOS APIs and returns JSON-serializable dictionaries.
/// Sensitive data is only returned after iOS has granted the relevant permission.
enum NativeToolRegistry {
    private static let baseDefinitions: [[String: Any]] = [
        ["name": "permissions.status", "description": "Return the current authorization state of supported iOS capabilities.", "input_schema": ["type": "object", "properties": [:]]],
        ["name": "contacts.search", "description": "Search contacts by name, email, or phone. Requires Contacts permission.", "input_schema": ["type": "object", "properties": ["query": ["type": "string"]], "required": ["query"]]],
        ["name": "calendar.list_events", "description": "List calendar events in an ISO-8601 date range. Requires Calendar permission.", "input_schema": ["type": "object", "properties": ["start": ["type": "string"], "end": ["type": "string"]], "required": ["start", "end"]]],
        ["name": "reminders.list", "description": "List reminders, optionally incomplete only. Requires Reminders permission.", "input_schema": ["type": "object", "properties": ["incomplete_only": ["type": "boolean"]]]],
        ["name": "notifications.schedule", "description": "Schedule a local notification after delay_seconds (1–604800) with title and body.", "input_schema": ["type": "object", "properties": ["title": ["type": "string"], "body": ["type": "string"], "delay_seconds": ["type": "number"]], "required": ["title", "body", "delay_seconds"]]],
        ["name": "notifications.cancel", "description": "Cancel a previously scheduled local notification by identifier.", "input_schema": ["type": "object", "properties": ["identifier": ["type": "string"]], "required": ["identifier"]]],
        ["name": "app.open_url", "description": "Ask iOS to open a URL or registered app URL scheme. The system may show confirmation or refuse.", "input_schema": ["type": "object", "properties": ["url": ["type": "string"]], "required": ["url"]]]
    ]

    static var definitions: [[String: Any]] { baseDefinitions + ExtendedNativeTools.definitions }

    static func invoke(name: String, arguments: [String: Any]) async -> (Int, [String: Any]) {
        switch name {
        case "permissions.status":
            return (200, await permissionSnapshot())
        case "contacts.search":
            guard let query = arguments["query"] as? String, !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                return (400, ["error": "query is required"])
            }
            return await searchContacts(query)
        case "calendar.list_events":
            guard let startText = arguments["start"] as? String,
                  let endText = arguments["end"] as? String,
                  let start = ISO8601DateFormatter().date(from: startText),
                  let end = ISO8601DateFormatter().date(from: endText), end > start else {
                return (400, ["error": "start and end must be valid ISO-8601 dates, with end after start"])
            }
            return await listEvents(start: start, end: end)
        case "reminders.list":
            return await listReminders(incompleteOnly: arguments["incomplete_only"] as? Bool ?? false)
        case "notifications.schedule":
            guard let title = arguments["title"] as? String, !title.isEmpty,
                  let body = arguments["body"] as? String,
                  let delay = arguments["delay_seconds"] as? NSNumber,
                  delay.doubleValue >= 1, delay.doubleValue <= 604800 else {
                return (400, ["error": "title, body, and delay_seconds (1–604800) are required"])
            }
            return await scheduleNotification(title: title, body: body, delay: delay.doubleValue)
        case "notifications.cancel":
            guard let identifier = arguments["identifier"] as? String, !identifier.isEmpty else {
                return (400, ["error": "identifier is required"])
            }
            UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [identifier])
            return (200, ["ok": true, "identifier": identifier])
        case "app.open_url":
            guard let text = arguments["url"] as? String, let url = URL(string: text),
                  let scheme = url.scheme?.lowercased(), ["https", "http", "maps", "mailto", "tel", "sms"].contains(scheme) else {
                return (400, ["error": "url must use an allowed public scheme: https, http, maps, mailto, tel, or sms"])
            }
            let opened: Bool = await withCheckedContinuation { continuation in
                DispatchQueue.main.async { UIApplication.shared.open(url, options: [:]) { continuation.resume(returning: $0) } }
            }
            return opened ? (200, ["ok": true]) : (409, ["error": "iOS could not open this URL"])
        default:
            return await ExtendedNativeTools.invoke(name: name, arguments: arguments)
        }
    }

    private static func permissionSnapshot() async -> [String: Any] {
        let contact = CNContactStore.authorizationStatus(for: .contacts)
        let calendar = EKEventStore.authorizationStatus(for: .event)
        let reminders = EKEventStore.authorizationStatus(for: .reminder)
        let photos = photoLabel(PHPhotoLibrary.authorizationStatus(for: .readWrite))
        let notifications = await UNUserNotificationCenter.current().notificationSettings()
        return [
            "contacts": contactLabel(contact),
            "calendar": eventLabel(calendar),
            "reminders": eventLabel(reminders),
            "photos": photos,
            "notifications": String(describing: notifications.authorizationStatus),
            "location": String(describing: CLLocationManager.authorizationStatus())
        ]
    }

    private static func photoLabel(_ status: PHAuthorizationStatus) -> String {
        switch status {
        case .authorized: return "authorized"
        case .limited: return "limited"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "not_determined"
        @unknown default: return "unknown"
        }
    }

    private static func contactLabel(_ status: CNAuthorizationStatus) -> String {
        switch status { case .authorized: return "authorized"; case .denied: return "denied"; case .restricted: return "restricted"; case .notDetermined: return "not_determined"; @unknown default: return "unknown" }
    }

    private static func hasEventReadAccess(_ status: EKAuthorizationStatus) -> Bool {
        if status == .authorized { return true }
        if #available(iOS 17.0, *), status == .fullAccess { return true }
        return false
    }

    private static func eventLabel(_ status: EKAuthorizationStatus) -> String {
        if #available(iOS 17.0, *) {
            if status == .fullAccess { return "authorized" }
            if status == .writeOnly { return "write_only" }
        }
        switch status {
        case .authorized: return "authorized"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "not_determined"
        @unknown default: return "unknown"
        }
    }

    private static func searchContacts(_ query: String) async -> (Int, [String: Any]) {
        let store = CNContactStore()
        let status = CNContactStore.authorizationStatus(for: .contacts)
        if status == .notDetermined {
            let granted = await withCheckedContinuation { continuation in
                store.requestAccess(for: .contacts) { granted, _ in continuation.resume(returning: granted) }
            }
            guard granted else { return (403, ["error": "contacts_permission_denied"]) }
        } else if status != .authorized {
            return (403, ["error": "contacts_permission_denied", "status": contactLabel(status)])
        }
        let keys: [CNKeyDescriptor] = [CNContactGivenNameKey, CNContactFamilyNameKey, CNContactEmailAddressesKey, CNContactPhoneNumbersKey, CNContactIdentifierKey] as [CNKeyDescriptor]
        let request = CNContactFetchRequest(keysToFetch: keys)
        request.unifyResults = true
        var matches: [[String: Any]] = []
        do {
            try store.enumerateContacts(with: request) { contact, stop in
                let fullName = "\(contact.givenName) \(contact.familyName)".trimmingCharacters(in: .whitespaces)
                let values = [fullName] + contact.emailAddresses.map { String($0.value) } + contact.phoneNumbers.map { $0.value.stringValue }
                if values.contains(where: { $0.localizedCaseInsensitiveContains(query) }) {
                    matches.append([
                        "id": contact.identifier,
                        "name": fullName,
                        "emails": contact.emailAddresses.map { String($0.value) },
                        "phones": contact.phoneNumbers.map { $0.value.stringValue }
                    ])
                    if matches.count >= 50 { stop.pointee = true }
                }
            }
            return (200, ["contacts": matches, "count": matches.count, "truncated": matches.count == 50])
        } catch {
            return (500, ["error": "contacts_query_failed", "detail": error.localizedDescription])
        }
    }

    private static func listEvents(start: Date, end: Date) async -> (Int, [String: Any]) {
        let store = EKEventStore()
        let status = EKEventStore.authorizationStatus(for: .event)
        if status == .notDetermined {
            let granted = await withCheckedContinuation { continuation in
                store.requestAccess(to: .event) { granted, _ in continuation.resume(returning: granted) }
            }
            guard granted else { return (403, ["error": "calendar_permission_denied"]) }
        } else if !hasEventReadAccess(status) {
            return (403, ["error": "calendar_permission_denied", "status": eventLabel(status)])
        }
        let predicate = store.predicateForEvents(withStart: start, end: end, calendars: nil)
        let events = store.events(matching: predicate).prefix(200).map { event -> [String: Any] in
            ["id": event.eventIdentifier ?? "", "title": event.title ?? "", "start": ISO8601DateFormatter().string(from: event.startDate), "end": ISO8601DateFormatter().string(from: event.endDate), "all_day": event.isAllDay, "calendar": event.calendar.title]
        }
        return (200, ["events": Array(events), "count": events.count])
    }

    private static func listReminders(incompleteOnly: Bool) async -> (Int, [String: Any]) {
        let store = EKEventStore()
        let status = EKEventStore.authorizationStatus(for: .reminder)
        if status == .notDetermined {
            let granted = await withCheckedContinuation { continuation in
                store.requestAccess(to: .reminder) { granted, _ in continuation.resume(returning: granted) }
            }
            guard granted else { return (403, ["error": "reminders_permission_denied"]) }
        } else if !hasEventReadAccess(status) {
            return (403, ["error": "reminders_permission_denied", "status": eventLabel(status)])
        }
        return await withCheckedContinuation { continuation in
            let predicate = incompleteOnly ? store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil) : store.predicateForReminders(in: nil)
            store.fetchReminders(matching: predicate) { reminders in
                let rows: [[String: Any]] = (reminders ?? []).prefix(200).map { reminder in
                    var row: [String: Any] = ["id": reminder.calendarItemIdentifier, "title": reminder.title ?? "", "completed": reminder.isCompleted]
                    if let due = reminder.dueDateComponents?.date { row["due"] = ISO8601DateFormatter().string(from: due) }
                    return row
                }
                continuation.resume(returning: (200, ["reminders": rows, "count": rows.count]))
            }
        }
    }

    private static func scheduleNotification(title: String, body: String, delay: Double) async -> (Int, [String: Any]) {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        if settings.authorizationStatus == .notDetermined {
            let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
            guard granted else { return (403, ["error": "notifications_permission_denied"]) }
        } else if settings.authorizationStatus == .denied {
            return (403, ["error": "notifications_permission_denied"])
        }
        let identifier = UUID().uuidString
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: UNTimeIntervalNotificationTrigger(timeInterval: delay, repeats: false))
        do {
            try await center.add(request)
            return (200, ["ok": true, "identifier": identifier, "fires_in_seconds": delay])
        } catch {
            return (500, ["error": "notification_schedule_failed", "detail": error.localizedDescription])
        }
    }
}
