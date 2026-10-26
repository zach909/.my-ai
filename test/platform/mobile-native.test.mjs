/**
 * The native phone apps, checked as source (no Android SDK or Xcode runs here; the CI jobs compile them).
 * These guard the specific faults that made the phone interface look dead: a wrong default port, an address
 * without a scheme, controls pushed off the edge of the screen, a chat panel with no height, a blank page when
 * the server is unreachable, and a button that silently closed its own screen.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const text = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = path.join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const KT = 'mobile/android/app/src/main/java/ai/neuroclaw/app';

test('neither app points people at the old dev-server port; the server is on 7861', () => {
  for (const f of [...walk(path.join(ROOT, 'mobile/android/app/src')), ...walk(path.join(ROOT, 'mobile/ios/NeuroClaw'))]) {
    if (!/\.(kt|swift|xml)$/.test(f)) continue;
    assert.doesNotMatch(readFileSync(f, 'utf8'), /:3000\b/, `${path.relative(ROOT, f)} mentions port 3000`);
  }
  assert.match(text(`${KT}/MainActivity.kt`), /192\.168\.1\.20:7861/);
});

test('Android: an address typed without http:// still works, and an empty one is explained, not silently dropped', () => {
  const settings = text(`${KT}/Settings.kt`);
  assert.match(settings, /fun normalizeServerUrl/);
  assert.match(settings, /"http:\/\/\$trimmed"/);
  assert.match(settings, /serverUrl", normalizeServerUrl\(value\)/);
  const web = text(`${KT}/WebActivity.kt`);
  assert.match(web, /Toast\.makeText[^\n]*Enter your PC address/, 'the screen no longer just closes');
  assert.match(web, /Open web app|EXTRA_PATH/);
});

test('Android: the web screens open the shared interface (home and /settings), not the legacy WebGL dashboard', () => {
  const web = text(`${KT}/WebActivity.kt`);
  assert.doesNotMatch(web, /loadUrl\("\$base\/app"\)/);
  assert.match(web, /loadUrl\("\$base\$path"\)/);
  assert.match(web, /startsWith\("\/"\)/, 'only same-server paths can be requested');
  const main = text(`${KT}/MainActivity.kt`);
  assert.match(main, /openWeb\("\/"\)/);
  assert.match(main, /openWeb\("\/settings"\)/);
});

test('Android: a server that cannot be reached shows a page that says so, and web permissions go only to the chosen server', () => {
  const web = text(`${KT}/WebActivity.kt`);
  assert.match(web, /onReceivedError/);
  assert.match(web, /request\.isForMainFrame/);
  assert.match(web, /Try again/);
  assert.match(web, /request\.origin\.toString\(\)\.startsWith\(base\)/);
  assert.match(web, /request\.deny\(\)/);
  assert.doesNotMatch(web, /request\.grant\(request\.resources\)\s*$/m, 'no unconditional grant');
});

test('Android: buttons share the row width, and the chat panel has a real height inside the scrolling screen', () => {
  const main = text(`${KT}/MainActivity.kt`);
  assert.match(main, /private fun row\(/);
  assert.match(main, /LinearLayout\.LayoutParams\(0, LinearLayout\.LayoutParams\.WRAP_CONTENT, 1f\)/);
  assert.doesNotMatch(main, /addView\(LinearLayout\(context\)\.apply \{ addView\(save\)/, 'no row of unweighted buttons that runs off the screen');
  assert.doesNotMatch(main, /ChatPanel\(context\), LinearLayout\.LayoutParams\([^)]*, 0, 1f\)/, 'a weight inside a ScrollView gives height 0');
  assert.match(main, /ChatPanel\(context\), LinearLayout\.LayoutParams\([^)]*\(420 \* resources\.displayMetrics\.density\)/);
});

test('Android: every button declared on the main screen has a click action', () => {
  const main = text(`${KT}/MainActivity.kt`);
  const buttons = [...main.matchAll(/Button\(this\)\.apply \{/g)].length;
  assert.ok(buttons >= 10);
  // Each Button(this).apply { ... } block must contain a setOnClickListener before the next block starts.
  for (const block of main.split('Button(this).apply {').slice(1)) assert.match(block.slice(0, 900), /setOnClickListener|text = if/, 'a button with no click handler');
});

test('iOS: addresses are normalised, the web view opens the shared interface and Settings, and failures are shown', () => {
  const web = text('mobile/ios/NeuroClaw/WebAppView.swift');
  assert.match(web, /static func normalized/);
  assert.match(web, /"http:\/\/" \+ s/);
  assert.match(web, /URL\(string: base \+ path\)/);
  assert.doesNotMatch(web, /base \+ "\/app"/);
  assert.match(web, /didFailProvisionalNavigation/);
  assert.match(web, /Can't reach NeuroClaw/);
  const content = text('mobile/ios/NeuroClaw/ContentView.swift');
  assert.match(content, /webPath = "\/settings"/);
  assert.match(content, /WebAppView\(urlString: brain\.serverURL, path: webPath\)/);
});

test('both apps carry the one application version from package.json', () => {
  const v = JSON.parse(text('package.json')).version;
  assert.match(text('mobile/android/app/build.gradle.kts'), new RegExp(`versionName = "${v.replace(/\./g, '\\.')}"`));
  assert.match(text('mobile/ios/project.yml'), new RegExp(`MARKETING_VERSION: "${v.replace(/\./g, '\\.')}"`));
  assert.match(text('mobile/ios/project.yml'), /CFBundleShortVersionString: "\$\(MARKETING_VERSION\)"/);
});

test('the phone apps only request the platform permission prompts they document, and declare no third-party libraries', () => {
  const gradle = text('mobile/android/app/build.gradle.kts');
  const deps = [...gradle.matchAll(/implementation\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  for (const d of deps) assert.ok(d.startsWith('androidx.core:core-ktx'), `unexpected dependency ${d}`);
  assert.match(text('mobile/ios/project.yml'), /NSMicrophoneUsageDescription/);
});

test('Android: NeuroClaw can be chosen as the default digital assistant, and only the system can bind to it', () => {
  const manifest = text('mobile/android/app/src/main/AndroidManifest.xml');
  // Both services must demand the system-only permission, or any app could bind to them.
  for (const name of ['NeuroVoiceInteractionService', 'NeuroSessionService']) {
    const tag = new RegExp(`<service[^>]*android:name="\\.${name}"[\\s\\S]*?(?:/>|</service>)`).exec(manifest);
    assert.ok(tag, `${name} is declared`);
    assert.match(tag[0], /android:permission="android\.permission\.BIND_VOICE_INTERACTION"/, `${name} is bind-protected`);
  }
  assert.match(manifest, /android\.service\.voice\.VoiceInteractionService/);
  assert.match(manifest, /android:name="android\.voice_interaction" android:resource="@xml\/voice_interaction_service"/);
  const meta = text('mobile/android/app/src/main/res/xml/voice_interaction_service.xml');
  assert.match(meta, /<voice-interaction-service/);
  assert.match(meta, /android:sessionService="ai\.neuroclaw\.app\.NeuroSessionService"/);
  assert.match(meta, /android:supportsAssist="true"/);
  // The metadata names classes that exist.
  const kt = text(`${KT}/AssistantService.kt`);
  assert.match(kt, /class NeuroVoiceInteractionService : VoiceInteractionService\(\)/);
  assert.match(kt, /class NeuroSessionService : VoiceInteractionSessionService\(\)/);
  assert.match(kt, /override fun onNewSession\(args: Bundle\?\): VoiceInteractionSession/);
  assert.match(kt, /override fun onShow\(args: Bundle\?, showFlags: Int\)/);
});

test('Android: invoking the assistant opens the chat sheet, which has a way out and a real height', () => {
  const manifest = text('mobile/android/app/src/main/AndroidManifest.xml');
  const activity = /<activity[^>]*android:name="\.AssistActivity"[\s\S]*?<\/activity>/.exec(manifest)?.[0] ?? '';
  assert.match(activity, /android\.intent\.action\.ASSIST/, 'the assist action opens the sheet');
  assert.match(activity, /android:exported="true"/);
  assert.doesNotMatch(/<activity[^>]*android:name="\.MainActivity"[\s\S]*?<\/activity>/.exec(manifest)[0], /ASSIST/, 'and not the setup screen');
  const session = text(`${KT}/AssistantService.kt`);
  assert.match(session, /Intent\(context, AssistActivity::class\.java\)/);
  assert.match(session, /startAssistantActivity\(open\)/);
  assert.match(session, /catch \(_: Exception\)[\s\S]*context\.startActivity\(open\)/, 'a phone that refuses the assistant launch still gets the sheet');
  assert.match(session, /hide\(\)/);
  const sheet = text(`${KT}/AssistActivity.kt`);
  assert.match(sheet, /ChatPanel\(this\) \{ finish\(\) \}/, 'Close works');
  assert.match(sheet, /setOnClickListener \{ finish\(\) \}/, 'a tap outside dismisses it');
  assert.match(sheet, /panel\.isClickable = true/, 'a tap on the panel does not dismiss it');
  assert.match(sheet, /heightPixels \* 0\.6/, 'a real height, not weight 0');
});

test('Android: the setup screen has a button that opens the system page where the assistant is chosen, and says so when it already is', () => {
  const main = text(`${KT}/MainActivity.kt`);
  assert.match(main, /text = "Make NeuroClaw my assistant"/);
  assert.match(main, /VoiceInteractionService\.isActiveService\(this@MainActivity, me\)/);
  assert.match(main, /ACTION_VOICE_INPUT_SETTINGS/);
  assert.match(main, /ACTION_MANAGE_DEFAULT_APPS_SETTINGS/, 'a fallback page for phones without the first');
  assert.match(main, /addView\(assistant\)/, 'the button is on the screen');
  assert.match(main, /Only you can change this/, 'it does not pretend the app can take the role itself');
});
