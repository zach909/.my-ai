package ai.neuroclaw.app

import android.app.Activity
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.FrameLayout

/**
 * The assistant sheet: the conversation panel over the bottom of the screen, opened by the system's assist
 * gesture once NeuroClaw is the default assistant (see AssistantService.kt), and by any app that sends the
 * ASSIST action. A tap outside the panel, or Close, dismisses it. The conversation is the same ChatPanel the
 * floating bubble uses, so it answers from the PC when reachable and from the on-phone brain when not.
 */
class AssistActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val margin = (8 * resources.displayMetrics.density).toInt()
        val height = (resources.displayMetrics.heightPixels * 0.6).toInt()
        val panel = ChatPanel(this) { finish() }
        // Without this a tap on the panel's own background would fall through to the dismiss handler below.
        panel.isClickable = true
        val root = FrameLayout(this).apply {
            setOnClickListener { finish() }
            addView(
                panel,
                FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, height, Gravity.BOTTOM).apply {
                    setMargins(margin, margin, margin, margin)
                },
            )
        }
        setContentView(root)
    }
}
