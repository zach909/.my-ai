package ai.neuroclaw.app

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.view.Gravity
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

/**
 * The conversation view, shared by the floating bubble's panel and the main
 * screen: transcript, a message box, Send, a mic for voice-to-text, a camera
 * button for a training photo, and a Screen button so it can see what's on
 * your screen (both go through the tap-to-capture pipeline, uploaded to the
 * PC as training data).
 */
class ChatPanel(context: Context, private val onClose: (() -> Unit)? = null) : LinearLayout(context) {
    private val transcript = TextView(context).apply { textSize = 15f; setTextIsSelectable(true) }
    private val scroll = ScrollView(context).apply { addView(transcript) }
    private val input = EditText(context).apply {
        hint = "Talk to NeuroClaw"
        imeOptions = EditorInfo.IME_ACTION_SEND
        setSingleLine(false)
        maxLines = 4
    }
    private val send = Button(context).apply { text = "Send" }
    private val mic = Button(context).apply { text = "🎙" } // microphone glyph
    private val camera = Button(context).apply { text = "Photo" }
    private val screen = Button(context).apply { text = "Screen" }
    private var recognizer: SpeechRecognizer? = null
    private var listening = false

    init {
        orientation = VERTICAL
        setPadding(dp(12), dp(12), dp(12), dp(12))
        background = GradientDrawable().apply { setColor(Color.WHITE); cornerRadius = dp(16).toFloat() }
        if (onClose != null) {
            addView(LinearLayout(context).apply {
                gravity = Gravity.END
                addView(Button(context).apply { text = "Close"; setOnClickListener { onClose.invoke() } })
            })
        }
        addView(scroll, LayoutParams(LayoutParams.MATCH_PARENT, 0, 1f))
        addView(LinearLayout(context).apply {
            orientation = HORIZONTAL
            addView(input, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
            addView(mic)
            addView(camera)
            addView(screen)
            addView(send)
        })
        send.setOnClickListener { submit() }
        input.setOnEditorActionListener { _, id, _ -> if (id == EditorInfo.IME_ACTION_SEND) { submit(); true } else false }
        mic.setOnClickListener { toggleListening() }
        camera.setOnClickListener {
            // Whatever is typed goes with the photo as its note.
            context.startActivity(
                Intent(context, CaptureActivity::class.java)
                    .putExtra(CaptureActivity.EXTRA_NOTE, input.text.toString())
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        }
        screen.setOnClickListener {
            context.startActivity(
                Intent(context, ScreenCaptureActivity::class.java)
                    .putExtra(ScreenCaptureActivity.EXTRA_NOTE, input.text.toString())
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        }
        append("NeuroClaw runs on this phone; it syncs with your PC when it can reach it.")
    }

    /** Voice-to-text: tap to start listening, tap again (or silence) to stop; the words land in the input box. */
    private fun toggleListening() {
        if (listening) { stopListening(); return }
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            Toast.makeText(context, "No speech recognizer on this device", Toast.LENGTH_SHORT).show()
            return
        }
        if (context.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            Toast.makeText(context, "Grant microphone access first, in the app's main screen", Toast.LENGTH_LONG).show()
            return
        }
        val r = recognizer ?: SpeechRecognizer.createSpeechRecognizer(context).also { recognizer = it }
        r.setRecognitionListener(object : RecognitionListener {
            override fun onResults(results: Bundle) {
                val text = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                if (!text.isNullOrBlank()) input.setText(if (input.text.isBlank()) text else "${input.text} $text")
                listening = false; mic.text = "🎙"
            }
            override fun onError(error: Int) { listening = false; mic.text = "🎙" }
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onPartialResults(partialResults: Bundle?) {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        r.startListening(intent)
        listening = true
        mic.text = "⏹" // stop glyph
    }

    private fun stopListening() {
        recognizer?.stopListening()
        listening = false
        mic.text = "🎙"
    }

    private fun submit() {
        val text = input.text.toString().trim()
        if (text.isEmpty()) return
        input.setText("")
        append("You: $text")
        send.isEnabled = false
        Shared.background({ Shared.brain(context).send(text) }) { reply ->
            append("NeuroClaw: ${reply.text}")
            send.isEnabled = true
        }
    }

    private fun append(line: String) {
        transcript.append(if (transcript.text.isEmpty()) line else "\n\n$line")
        scroll.post { scroll.fullScroll(ScrollView.FOCUS_DOWN) }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
}
