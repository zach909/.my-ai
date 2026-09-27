package ai.neuroclaw.app

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * The conversation view, shared by the floating bubble's panel and the main
 * screen: transcript, a message box, Send, and a camera button that takes
 * one photo for training data.
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
    private val camera = Button(context).apply { text = "Photo" }

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
            addView(camera)
            addView(send)
        })
        send.setOnClickListener { submit() }
        input.setOnEditorActionListener { _, id, _ -> if (id == EditorInfo.IME_ACTION_SEND) { submit(); true } else false }
        camera.setOnClickListener {
            // Whatever is typed goes with the photo as its note.
            context.startActivity(
                Intent(context, CaptureActivity::class.java)
                    .putExtra(CaptureActivity.EXTRA_NOTE, input.text.toString())
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        }
        val (messages, captures) = Shared.brain(context).pendingCount()
        if (messages + captures > 0) append("Waiting to send to your PC: $messages message(s), $captures photo(s).")
    }

    private fun submit() {
        val text = input.text.toString().trim()
        if (text.isEmpty()) return
        input.setText("")
        append("You: $text")
        send.isEnabled = false
        Shared.background({ Shared.brain(context).send(text) }) { reply ->
            append("NeuroClaw${if (reply.offline) " (offline)" else ""}: ${reply.text}")
            send.isEnabled = true
        }
    }

    private fun append(line: String) {
        transcript.append(if (transcript.text.isEmpty()) line else "\n\n$line")
        scroll.post { scroll.fullScroll(ScrollView.FOCUS_DOWN) }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
}
