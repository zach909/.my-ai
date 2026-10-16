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

## Projects (in the wiki)

A project is a folder of tasks with a fixed pot (90% pays tasks by weight, 10% is the completion bonus split by how much each worker did). Take a task, hand it in, and someone **other than you** checks it. Rejected work goes back for a fix, then opens to anyone after 3 tries. The plan is fixed once the first task is paid.

Each project is mirrored to the wiki page `projects/<id>` with its full state embedded, so another install can import it. Pushing is a separate button (**Publish to the wiki**). Importing is last-writer-wins and never pays anyone.

The **agent** can break a goal into folders and tasks, and file unsorted tasks into folders. Its reply is read strictly; if it cannot be read, a plain split of the goal is used instead.

## The hive

Press **Run the hive** and the project is worked by a team of AIs:

- **Equal authority.** Every agent has one vote, always. Review and removal count votes, never weigh them.
- **They check each other.** Two other agents check every hand-in. Accept needs strictly more accepts than rejects; a tie rejects; a reply that is not clearly ACCEPT or REJECT counts for neither, and if nobody is clear the task waits for a person.
- **Voting out.** An agent whose work keeps being rejected can be removed by a strict majority of all the others. The team never drops below 2, and the removed agent's learning is discarded.
- **Sub-AIs.** An agent with many tasks summons helpers that do tasks for it. They have no vote and learn nothing of their own.
- **AIs only check AIs.** A person's hand-in is checked by a person.
- **Value.** Separate from votes: a zero-sum budget (the Hive Mind's trust) that moves with accepted and rejected work. It does not buy a vote; it weights how much each agent's learning counts in the merge.

### When it finishes

Each agent started from the shared base network and was taught only its own work, so each learned differently. At completion their changes are **averaged** (weighted by value) into one contributor and saved to `extension-builder/shared-mesh/deltas/`. Everyone's contributors are averaged together when a network loads (see [[Neuron-Mesh]] shared learning), so the result is blended in, never swapped in over what others taught.

Limits, stated plainly:

- While working, every agent still answers through the one live brain; what differs is what each *learns*.
- Teaching goes through the Zip Loop a byte at a time, so it is slow and capped per call.
- Nothing is pushed to GitHub unless shared learning is on (`NEUROCLAW_SHARED_LEARNING=1`); otherwise the merged file stays on the device and the page says so.

## Chats

Chats are still filed instantly into groups by the words in them. The agent then gives each group a proper topic name in the background (`NEUROCLAW_AGENT_ORGANIZE=0` turns that off). A reply it cannot read changes nothing.
