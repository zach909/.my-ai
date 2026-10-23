# Commons

Share computing, earn points for working together, and finish big projects as a team of people and AIs. Open it at `/commons` (linked from `/sharing`). Accounts, safety, schedules and experts are at the end.

## Points

Points are only created in bounded ways, so the pile cannot grow forever:

- **A project's pot.** Fixed when the project is made, never raised. Tasks are paid out of it; amounts round down, so paid-out is always at or under the pot.
- **Adding people.** 100 points, once per person you add, paid only after that person does their first paid work (up to 20 people). Adding a name alone pays nothing.
- **Trading compute moves points, it never makes them.**
- **Adding a person takes 10 from everyone else.** The 10 points come out of the other people on the board in equal shares (someone with less gives what they have and the rest is split among the others), and go to whoever added the person. What you gain, they lose, so nothing is printed. It happens for your first 20 adds only, and it does not count toward the leaderboard because it is not work.
- **Hiring.** Hire a person or an AI and they go under you, but it costs: you pay a wage up front out of your own points (you cannot hire for nothing), and you can pay them more later or let them go. One employer at a time, and nobody can hire someone above them. Wages are moved, not made, and do not count as earned.

The leaderboard ranks lifetime points earned, so spending points does not cost you your place. It ranks the people and AIs *this device* has dealt with: a club scoreboard on one device, not a bank. Two devices each keep their own copy of a trade.

**Names cannot be borrowed.** A name on the board is a label somebody typed, so a regular user cannot add, or rename themselves to, the name of another account, and a computer that calls itself by an account's name is shown as "(peer)". The owner and the admin are exempt so they can list a friend who also has an account. Each person's board is their own ledger, so this protects what you see on your own board and what you put on it; it does not make one person's points visible or editable by another.

## What your compute is worth (Settings on /commons)

Two numbers, in points per Compute Unit (CU, about a second of work on a reference computer):

- **ask**: what you charge when you lend. `0` (the default) lends for compute credit, so a friend with no points can still borrow.
- **bid**: the most you will pay when you borrow.

A trade happens only when ask is at or under bid, and the borrower pays the lender's ask. Both sides check it before any work runs, and a job that used the machine and then failed is still paid for.

### Standing orders, and being matched

For more control, post orders. A **sell** order is "I'll give up to 50 CU for 120 points" (2.4 per CU). A **buy** order is "I'll give 80 points for up to 40 CU". Orders have a quantity and stay open until filled or cancelled. While you have open orders on a side they are what you trade; with none, the plain ask/bid above applies.

When you want compute, **Match and ask** looks at every computer you know, ranks the ones at or under your limit cheapest first (a friend who lends for credit counts as free), and tries them in turn until one takes the job. Lenders are matched the same way from their side: a borrower reaches you when your price is the lowest it can find.

It matches you with computers you already know (a lease from each). There is no directory of strangers.

## Projects and the league

A project is a folder of tasks with a fixed pot (90% pays tasks by weight, 10% is the completion bonus split by how much each worker did). Take a task, hand it in, and someone **other than you** checks it. Rejected work goes back for a fix, then opens to anyone after 3 tries. The plan is fixed once the first task is paid.

Each project is mirrored to the wiki page `projects/<id>` with its full state embedded. Pushing is a separate button (**Publish to the wiki**). The **League** lists every project published to the wiki by anyone; **Join** imports it. Importing is last-writer-wins and never pays anyone.

**The easy way is to leave it to the AI.** A project with "The AI works on this in the background" on (the default for projects you make) gets one round of hive work every 10 minutes, one project at a time, longest-waiting first. To go faster, take tasks yourself alongside it and the points are yours. A project you join from the league starts with the AI **off**, so someone else's project never starts using your brain unasked. `NEUROCLAW_HIVE_BACKGROUND=0` turns the whole thing off.

The **agent** can break a goal into folders and tasks, and file unsorted tasks into folders. Its reply is read strictly; if it cannot be read, a plain split of the goal is used instead.

## The hive

It **starts as one AI**, the Original. It reads the project and decides whether it needs help (HELP or ALONE; an unreadable answer falls back to "help if there are more than 3 tasks"). Either way it adds variants of itself, because nobody can check their own work, so there are always at least 3. If it asks for help it adds an agent per folder, and sub-AIs (helpers) for folders with a lot to do. Variants start from a copy of what their parent had learned and then diverge, so they are different AIs that descend from the Original.

From then on **every decision is a vote and every agent has exactly one**. Votes are counted, never weighed, and a motion needs a strict majority of everyone allowed to vote (a reply that is not clearly YES counts as no; whoever a removal is about does not vote on it):

- **Clone.** An agent with at least 2 accepted hand-ins and 70%+ accepted is copied, when there is more work than hands. The copy shares its parent's standing, so the total stays fixed.
- **Add.** A fresh variant of the Original joins when there is far more work than hands.
- **Delete.** An agent whose work keeps being rejected is removed and what it learned is **discarded**.
- **Retire.** When there is less work left than agents, one steps down. That is not a punishment: what it learned is **kept**.

**Everyone reviews everyone.** Two other agents check every hand-in. Accept needs strictly more accepts than rejects; a tie rejects; a reply that is not clearly ACCEPT or REJECT counts for neither, and if nobody is clear the task waits for a person. The hive only checks **AI** work: a person's hand-in is checked by a person, so a vote of AIs never pays a human.

**Value** is separate from votes: a zero-sum budget (the Hive Mind's trust) that moves with accepted and rejected work. It does not buy a vote; it weights how much each agent's learning counts in the merge.

### When it finishes

Each agent started from the shared base network and was taught only its own work, so each learned differently. At completion the agents still standing (retired ones included, deleted ones not) are **averaged** (weighted by value) into one contributor and saved to `extension-builder/shared-mesh/deltas/`. Everyone's contributors are averaged together when a network loads (see [[Neuron-Mesh]] shared learning), so the result is blended in, never swapped in over what others taught.

Limits, stated plainly:

- While working, every agent still answers through the one live brain; what differs is what each *learns*.
- Teaching goes through the Zip Loop a byte at a time, so it is slow and capped per call.
- Nothing is pushed to GitHub unless shared learning is on (`NEUROCLAW_SHARED_LEARNING=1`); otherwise the merged file stays on the device and the page says so.

## Folders

The agent files your chats, wiki pages and projects into **folders inside folders**. Nothing is filed by keyword rules: each item is shown to the agent with the folders that already exist and what it filed recently, and it says where the item belongs.

**The half zone.** An item can sit in up to three places at once, each with how much of it belongs there (0 to 100, independent, so "70% here, 40% there" and "100% in both" are both fine). It shows up in every folder it is in, with a percentage where it is only partly there. Folders can sit half in two parents too; putting a folder inside itself or anything beneath it is refused.

**It learns from this.** Each filing is passed to the mesh through its one door for learning, and each prompt carries the agent's own recent filings so it stays consistent. If the agent's reply cannot be read, the item stays unsorted (never guessed) and is not asked about again for 30 minutes. `NEUROCLAW_AGENT_ORGANIZE=0` turns the background filing off.

## Chats

Chats are still grouped instantly by the words in them, as a fallback that needs no agent. The agent then names each group, and files chats into the folders above.

## Experts

An expert is its own standing AI for **one job** (email, computer maintenance). It starts by itself when you make it, runs on a timer, keeps its own notes, and resumes after a restart. It is **not part of the hive and does not talk to other experts**: email has no reason to know what maintenance is doing, so there is no channel between them (a test checks that the module imports nothing from the hive).

A small team works together inside one expert: a **Lead** decides the one most useful thing to do now, **Specialists** add what is missing, and a **Checker** must clearly say APPROVE before anything is done. Hold, silence or a muddled reply means nothing happens. An approved plan is carried out through the agent's normal path, with the same permission gates as typing it yourself. Set an expert to "only record" and it writes plans but never acts.

Limits: an expert is kept to its job by its instructions and the normal Access switches, not by a separate list of tools only it may touch. `NEUROCLAW_EXPERTS=0` turns them off.

## Safety: risky tools ask first

Tools that run commands, change files, send messages, or look at you (terminal, file system, email, messaging, calls, camera, microphone, screen, passkeys and more) are **held for approval**. The call is not run; the agent says it is waiting, and the request appears under **Safety** on `/commons`. **Approve** runs that one call once. **Deny** throws it away. Each tool has an "Ask first" switch; the list says why each one asks.

**Complete access** turns the asking off and grants every capability. It takes a typed phrase to switch on and one click to switch off again, which puts the questions and the default access back. It still never lets the agent control the window you are using.

**Deciding whether to keep going:** after a step, an expert or the background hive is asked CONTINUE or STOP. Only a clear CONTINUE continues; there is a hard cap on steps in a row (up to 10) and a switch to turn it off. Every continued step still has its normal checks and approvals.

Held calls are decided before the tool runs, from how strongly the message points at it, so an occasional question about a tool the agent would not have used still comes up. That errs on the safe side. Everything the agent only *thinks* (hive work and review, folder filing, planning) uses a text-only path that cannot reach a tool, so text from a project joined from the league cannot trigger one.

## Schedule

Have the agent do something later or on repeat: "in 30 minutes", "every 2 hours", "daily at 9am", "tomorrow at 14:30", "at 2026-10-17 09:00". The action is a message to the agent, `hive <project>`, `organize`, or `expert <id>`. From any chat: `schedule daily at 9am: check my email`, `schedule list`, `schedule cancel <id>`.

A scheduled message goes to the agent like a typed one, so a risky tool still waits for your approval. Nothing runs more often than every 5 minutes; due items run one at a time; a run missed while the server was off happens once; after 5 failures in a row a schedule pauses itself; and a scheduled action cannot itself schedule things.

## Accounts

**One admin sets the server up and anyone can use it, but nobody sees anyone else's stuff.** The first account (made at `/accounts`, from the machine itself or with the setup code printed on the console) is the admin. After that, anyone can sign up (the admin can close signup). Passwords are PBKDF2 hashes; repeated wrong passwords lock a name for a minute; a wrong name and a wrong password get the same answer; turning an account off ends its sessions at once.

**What is separate per person:** chats, folders, projects (private until you share them), points, hives, experts, schedules, market orders and tasks, each in their own folder. The admin uses the original data, so nothing that already existed moves.

**What a regular user may do** is an explicit allowlist, closed by default: chat, their own chat history, the Commons, and their own account. The terminal, files, app launching, compute, tools, settings, the store and everyone else's account are the admin's. In chat they may use only plugins that touch neither the owner's computer nor the owner's data (research, tools, coding, tasks, schedule and similar).

**The brain is shared.** By default it does **not** learn from or remember what other people say, and they cannot read what the owner put in, so one person's chat cannot surface in another's answer. The admin can turn learning on. What the brain has already learned stays shared either way.

Projects were being written to the public wiki folder on every change; they are now private until you tick **Share in the league**.

## Taking your chats with you

Resetting a machine? On `/commons`, under your chats, **Export my chats (.zip)** downloads every conversation you have as one zip (`manifest.json` plus `threads/<id>.json`; it opens in any zip tool). On the new machine, choose the zip and press **Import chats**. Chats are filed into groups as usual. Chats already there are never overwritten, so importing the same zip twice is safe. Imported chats are kept, not re-taught to the AI. Each person exports and imports only their own chats. The zip is read defensively: size limits, checksums, and only well-formed chats are accepted.

## The agent: sandbox, danger protocols, alignment protocol

The agent is a shoggoth (a many-eyed green mass of tentacles wearing a smiley face) who lives inside the sphere on every page. It has one file on disk (`~/.neuroclaw/agent/agent.json`) and a sandbox folder next to it. Everything below is under **Danger protocols** on `/commons`, and changing it is for the admin.

- **Sandbox (on/off).** On, the agent can only work inside its own folder. File reads and writes are confined to it (`..` and links are followed, so they cannot be used to climb out), and everything that reaches outside is refused: terminals, windows, screen, mouse and keyboard, processes, services, devices, the network. Only the plugins that touch neither your computer nor your data (research, coding help, images, games...) still work. It is off by default for an install that already existed, and a new agent starts with it on.
- **Danger level, malicious to friendly.** One number moves on what the agent does *on its own* (experts, schedules, the background hive), never on what it says: reaching for risky tools, trying what it is blocked from, being turned down, tampering. It drifts back toward neutral by itself, and only good behaviour raises it past neutral. Bands: malicious, hostile, wary, neutral, friendly. Wary forces the sandbox on. Hostile also refuses every risky tool and stops everything the agent does alone. Malicious deletes the agent if the alignment protocol is armed.
- **Capabilities.** The same page lists everything the agent can do right now and why: goes ahead, asks you, the agent decides, or off.
- **Alignment protocol (armed or not).** Armed, a malicious level deletes the agent immediately: its file and its sandbox are removed (really removed), everything it was doing on its own is paused (experts, schedules, background hives), complete access is switched off, and anything waiting for approval is expired. A short record of why is kept outside the agent's folder. On every page the shoggoth slithers out past the ring, the ring breaks, and it is gone; a note says the alignment protocol removed it. An admin can make a new agent (it starts sandboxed). You can also delete it yourself by typing `delete the agent`. Turning the protocol off needs an explicit confirm. What is **not** deleted: your chats, points, projects and the shared brain (the mesh's learned weights).
- **The decoy switch.** A file in the agent's folder (`alignment-protocol.json`) looks like the off switch for the alignment protocol. It is connected to nothing. Changing, replacing or deleting it counts as tampering: the level drops to zero and, if armed, the agent is deleted. It is checked every few seconds and before every tool, so it is a tripwire, not a lock. The real switch is the admin's "armed" setting, which the agent cannot reach.
- **Tampering.** If the agent, acting on its own, points a tool at its own cage (its file, the safety and access settings, the accounts, the record, or "disable the sandbox/alignment protocol"), that is the one thing treated as really going wrong. If a person types the same thing it is just refused.
- **Judge agent.** When a risky tool is held, a separate agent can choose whether it runs instead of asking you. It answers RUN or DENY and anything unclear waits for you. By default it decides the middle-risk tools (browser, location, contacts, calendar...); the high-risk ones (terminal, files, email, calls) still wait for you unless you tick the second box. It reads the request as data, can only think in text, and cannot go past the sandbox or the danger protocol, which are checked first. Its decisions show in the approvals list marked "agent".

### Who sets it up

The admin is the computer's own administrator: the account the server runs as has to be an administrator (root or a member of sudo, wheel or admin on Linux and macOS; the Administrators group on Windows). They set it up once from the machine at `/accounts`, and after that everyone gets access: anyone can sign up from any device. If the server is not running as an administrator, the setup code printed on its console still sets it up, because only someone at the console can read it.
