package ai.neuroclaw.app

import android.content.Context
import android.os.Handler
import android.os.Looper
import java.util.concurrent.Executors

/** One Brain for the whole app (bubble, main screen, capture), so the conversation is shared. */
object Shared {
    @Volatile private var brain: Brain? = null
    val io = Executors.newSingleThreadExecutor()
    val main = Handler(Looper.getMainLooper())

    fun brain(context: Context): Brain =
        brain ?: synchronized(this) { brain ?: Brain(context.applicationContext).also { brain = it } }

    /** Run `work` off the main thread, then `done` on it. */
    fun <T> background(work: () -> T, done: (T) -> Unit) {
        io.execute {
            val result = work()
            main.post { done(result) }
        }
    }
}
