# Commons

Share computing, earn points for working together, and finish big projects as a team of people and AIs. Open it at `/commons` (linked from `/sharing`).

## Points

Points are only created in bounded ways, so the pile cannot grow forever:

- **A project's pot.** Fixed when the project is made, never raised. Tasks are paid out of it; amounts round down, so paid-out is always at or under the pot.
- **Adding people.** 25 points, once per person you add, paid only after that person does their first paid work (up to 20 people). Adding a name alone pays nothing.
- **Trading compute moves points, it never makes them.**

The leaderboard ranks lifetime points earned, so spending points does not cost you your place. It ranks the people and AIs *this device* has dealt with: a club scoreboard on one device, not a bank. Two devices each keep their own copy of a trade.

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
