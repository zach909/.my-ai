import SwiftUI
import UIKit

struct ContentView: View {
    @EnvironmentObject var brain: Brain
    @StateObject private var voice = VoiceRecognizer()
    @State private var input = ""
    @State private var showCamera = false
    @State private var showSettings = false
    @State private var showWeb = false
    @State private var toast: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 8) {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 12) {
                            let pending = brain.pending
                            Text("NeuroClaw runs on this phone and syncs with your PC when it can reach it.")
                                .font(.footnote).foregroundStyle(.secondary)
                            if pending.turns + pending.photos > 0 {
                                Text("Waiting to sync: \(pending.turns) turn(s), \(pending.photos) photo(s).")
                                    .font(.footnote).foregroundStyle(.secondary)
                            }
                            if !brain.syncStatus.isEmpty {
                                Text(brain.syncStatus).font(.footnote).foregroundStyle(.secondary)
                            }
                            ForEach(brain.lines) { line in
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(line.who).font(.caption).foregroundStyle(.secondary)
                                    Text(line.text).textSelection(.enabled)
                                }.id(line.id)
                            }
                        }.padding()
                    }
                    .onChange(of: brain.lines.count) { _ in
                        if let last = brain.lines.last { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                }
                if let toast { Text(toast).font(.footnote).foregroundStyle(.secondary) }
                HStack {
                    TextField("Talk to NeuroClaw", text: $input, axis: .vertical).textFieldStyle(.roundedBorder).lineLimit(1...4)
                    Button(voice.isListening ? "⏹" : "🎙") {
                        voice.toggle(
                            onText: { input = $0 },
                            onError: { toast = $0 }
                        )
                    }
                    Button("Photo") { showCamera = true }
                        .disabled(!UIImagePickerController.isSourceTypeAvailable(.camera))
                    Button("Send") {
                        voice.stop()
                        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !text.isEmpty else { return }
                        input = ""
                        Task { await brain.send(text) }
                    }.disabled(brain.busy)
                }.padding(.horizontal).padding(.bottom, 8)
            }
            .navigationTitle("NeuroClaw")
            .toolbar {
                Button("Web app") { showWeb = true }
                    .disabled(brain.serverURL.isEmpty)
                Button("Sync now") { Task { await brain.sync() } }
                Button("PC") { showSettings = true }
            }
            .sheet(isPresented: $showSettings) { SettingsView().environmentObject(brain) }
            .fullScreenCover(isPresented: $showWeb) {
                NavigationStack {
                    WebAppView(urlString: brain.serverURL)
                        .ignoresSafeArea(edges: .bottom)
                        .navigationTitle("NeuroClaw")
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar { Button("Close") { showWeb = false } }
                }
            }
            .sheet(isPresented: $showCamera) {
                // Nothing is captured unless you tap Photo; the note is whatever is typed.
                CameraView { image in
                    showCamera = false
                    guard let image else { return }
                    brain.capture(image, note: input)
                    toast = "Photo saved; it goes to your PC on the next sync"
                }.ignoresSafeArea()
            }
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject var brain: Brain
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Form {
                Section(footer: Text("Only for syncing: NeuroClaw runs on the phone either way. The address NeuroClaw's web app is on, e.g. http://192.168.1.20:7861, and the Remote Access password set there.")) {
                    TextField("PC address", text: $brain.serverURL).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Password (blank if none)", text: $brain.password)
                }
                Section {
                    NavigationLink("Permissions") { PermissionsView() }
                }
            }
            .navigationTitle("Your PC")
            .toolbar { Button("Done") { dismiss() } }
        }
    }
}

/// The system camera for one photo.
struct CameraView: UIViewControllerRepresentable {
    let done: (UIImage?) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(done: done) }
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}
    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let done: (UIImage?) -> Void
        init(done: @escaping (UIImage?) -> Void) { self.done = done }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            done(info[.originalImage] as? UIImage)
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { done(nil) }
    }
}
