import AVFoundation
import Speech

/// Voice-to-text for the chat composer's mic button: on-device live speech
/// recognition via AVAudioEngine + SFSpeechRecognizer, the same shape as
/// Android's SpeechRecognizer wiring in ChatPanel.kt. Needs the Microphone
/// and Speech Recognition permissions (Permissions.swift / the Permissions
/// screen) already granted; if either isn't, start() just reports that
/// rather than silently doing nothing.
@MainActor
final class VoiceRecognizer: ObservableObject {
    @Published var isListening = false

    private let recognizer = SFSpeechRecognizer()
    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    /// Tap to start listening, tap again (or silence) to stop. `onText` is
    /// called with the best transcript so far, each time it updates.
    func toggle(onText: @escaping (String) -> Void, onError: @escaping (String) -> Void) {
        if isListening {
            stop()
            return
        }
        guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
            onError("Grant Speech Recognition first, in Permissions.")
            return
        }
        // AVAudioSession.recordPermission (not the iOS-17-only AVAudioApplication
        // equivalent), since this app's deployment target is iOS 16.
        guard AVAudioSession.sharedInstance().recordPermission == .granted else {
            onError("Grant Microphone first, in Permissions.")
            return
        }
        guard let recognizer, recognizer.isAvailable else {
            onError("Speech recognition isn't available right now.")
            return
        }

        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            onError("Couldn't start the microphone: \(error.localizedDescription)")
            return
        }

        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        // Stays on-device when the platform supports it, so a voice note
        // never has to leave the phone just to become text.
        req.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition
        request = req

        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            req.append(buffer)
        }

        audioEngine.prepare()
        do {
            try audioEngine.start()
        } catch {
            onError("Couldn't start the microphone: \(error.localizedDescription)")
            cleanup()
            return
        }
        isListening = true

        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            Task { @MainActor in
                if let result {
                    onText(result.bestTranscription.formattedString)
                }
                if error != nil || result?.isFinal == true {
                    self?.stop()
                }
            }
        }
    }

    func stop() {
        guard isListening || audioEngine.isRunning else { return }
        cleanup()
    }

    private func cleanup() {
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        task = nil
        request = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        isListening = false
    }
}
