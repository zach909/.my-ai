package ai.neuroclaw.app

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.service.voice.VoiceInteractionService
import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService

/**
 * What lets NeuroClaw be the phone's default digital assistant, the role Gemini has by default.
 *
 * Android lets an app hold that role only if it declares a voice interaction service, and only the person
 * can hand it over: Settings > Apps > Default apps > Digital assistant app (the "Make NeuroClaw my assistant"
 * button on the main screen opens that page). Once chosen, the system opens this app wherever it opens the
 * assistant: a long press of the power button, the home-button or gesture-bar hold, the corner swipe.
 *
 * Two limits that are Android's, not this app's: there is no "Hey ..." wake word (that needs a privileged
 * hotword service only the phone's maker can install), and the system shows its own consent prompt on
 * first use. Voice typing inside the sheet uses the phone's own speech recogniser, as everywhere else here.
 */
class NeuroVoiceInteractionService : VoiceInteractionService()

/** The system asks this for a new session each time the assistant is invoked. */
class NeuroSessionService : VoiceInteractionSessionService() {
    override fun onNewSession(args: Bundle?): VoiceInteractionSession = NeuroSession(this)
}

/** One invocation: open the chat sheet in this app, then get out of the way. */
class NeuroSession(context: Context) : VoiceInteractionSession(context) {
    override fun onShow(args: Bundle?, showFlags: Int) {
        super.onShow(args, showFlags)
        val open = Intent(context, AssistActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        try {
            startAssistantActivity(open)
        } catch (_: Exception) {
            // Some phones refuse the assistant-typed launch; a plain launch from the session still opens the sheet.
            try { context.startActivity(open) } catch (_: Exception) { /* nothing more can be done from here */ }
        }
        hide()
    }
}
