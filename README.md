# Nest Projects

Job board for engineer-to-order work. Every job is an ERPNext **Project**; this
app puts them all on one Kanban board, from order to customer ready, and makes
each handover between people visible.

Requires `erpnext` only. No client-specific settings are hardcoded.

## What it adds

- **Job Stage** — the board's columns, in order. Each stage can name who usually
  handles it, limit who can be picked by role, and set a gate the job must pass
  before it can leave (drawing approved / QC checks complete). Eight default
  stages are seeded on a fresh site.
- **Job tab on Project** — stage, responsible person, progress (queued / in
  progress), next action, quote no, customer PO, site, held up (a reason from a
  short list, who it is waiting on, details), plus tables for drawings (with
  revisions), key materials (with a long-lead flag), QC/FAT, payment milestones
  and the stage history.

Project's own customer, priority and expected end date (due date) are used as-is.

## Job Board (`/desk/job-board`)

- One column per stage; a Project appears once it has a stage.
- Cards are kept simple: job no, customer, site, due date (amber within 7 days,
  red when overdue), what's holding it up ("GA approval · waiting on Paul" and
  the details), the next action, the responsible person and time in the stage.
  Tags only for what needs attention: a drawing not yet approved, materials
  still to come (long-lead first), QC or ready checks in their own stage.
- Stat tiles in the header are the filters: active, with me (yours, or waiting
  on you), held up, overdue, due in 7 days. Search covers job, customer, site,
  person, next action and what it's held up by.
- **Wall screen:** `/desk/job-board?tv=1` shows the board alone and larger for a
  TV in the office; it refreshes itself.
- **Handover:** drag a card to another column, tap its arrow, or press Hand
  over in the job panel. One dialog asks which stage (any stage, forwards or
  back; it suggests the next one, or where the card was dropped) and who takes
  it (prefilled from the stage's usual person), plus an optional note. The
  button reads Send Back for an earlier stage. The new person gets an alert;
  the move goes in Stage History.
- **Gates:** a job can't move forward past a stage whose gate isn't met. Moving
  back is always allowed. The same rules apply when the stage is changed on the
  Project form.
- **By Person view** (toggle next to search, remembered per browser): one
  column per person, "On it now" then "Next up" by priority and due date, each
  card tagged with its stage; held-up and overdue counts in each header; an
  Unassigned column. Stage regulars show even when idle. Dragging a card to
  another person reassigns it (alert + history row).
- Tapping a card's Queued / On it pill flips what the person is working on now.
- **Fits the screen:** columns share the width (the board only scrolls below
  a minimum column width). Empty columns and the finished stage fold to a slim
  strip with a count; click to open, or fold any column from its header.
  Narrow columns show compact cards (tags on hover and in the panel). Folded
  strips still accept a dragged card.
- **Pick what to show:** the Stages button (By Stage) or People button (By
  Person) opens a tick-list, e.g. only the engineering stages, or only the
  engineers. Tiles count what is shown. Each is remembered per browser.
- On phones the board shows one column per screen with chips to jump.
- Refreshes itself when any Project changes, and every minute.
- A link can open one job's panel: `/desk/job-board?job=JOB-350` (the shop
  floor screens use this when a job card is scanned).

## Job panel

Tapping a card opens the job beside the board instead of the Project form:
responsible person (On it / Queued, Change), due date and priority (Change asks
why; the history records who, old to new and the reason), quote and PO, held up
(Mark as held up: reason, waiting on, details / Sorted), the next action,
drawings with revisions (Sent to client, Client approved, New revision with
upload; older revisions are superseded), materials, QC / FAT (one tick: QC / FAT
passed), Customer Ready checks (tap to tick; who and when is recorded), payment
milestones (Mark invoiced with the Sage invoice number) and the history.
The footer hands over or sends back, and says why when a gate blocks it.

## Materials

Only the key and long-lead items, not every nut and bolt: the workshop runs its
own stock. **Add item** puts one on the job; tap its status to move it
To Order → Ordered → Received. Tap the hourglass to flag it **long-lead**, so it
is ordered as soon as engineering knows it is needed, before the drawing is
signed off. Marking an item Received, or flagging one long-lead, alerts the
job's people: the responsible person, everyone the job has been with, and the
usual person for each later stage. Lines linked to a purchase order (from
earlier versions) still follow it.

## Quotes (the sales register)

The third view on the board replaces their Excel sales register. **Job Quote**
holds the basics only: customer (typed; a Customer record is made only when
won), description, value incl VAT, date, rep, follow-up date, status
(Open / Won / Lost, with a reason) and the quote document. Not connected to Sage.

- Tiles: open quotes, pipeline value, follow-ups due, won this month, lost,
  win rate over 90 days. Open quotes sort by follow-up date, most overdue first.
- **Won** asks for the PO number, due date and job title, plus the Order Face
  ticks (packaging, delivery, installation, safety file, sub-contractor). It
  creates the job at the first stage with the quote linked, the 20/30/50
  payment milestones, and one Customer Ready check per tick (plus "customer
  confirmed ready for dispatch"). The board then opens the new job.
- Stage gate **Ready checks complete** (Customer Ready by default) stops a job
  being released until those checks are ticked.

## Demo data

On an empty board a System Manager or Projects Manager sees **Load demo jobs**.
It loads into the company of whoever presses it (the presenter login's default
company), and creates eleven anonymised engineer-to-order jobs (JOB-345 to
JOB-355), six people (`@acme-demo.test`, Projects User, limited to that company,
no password, email alerts off), the customers, drawings with generated A3 GA
sheets, key materials (some long-lead), next actions, held-up reasons, 20/30/50
payment milestones and back-dated stage history. All dates are relative to the
day it's loaded. It also loads their August sales register (26 quotes) plus
the 11 quotes that became the jobs. New projects then continue as JOB-356 and
new quotes as AT1430. No stock, suppliers or purchase orders.

The broom button (System Manager) removes the demo, the jobs created since it
was loaded **in the demo's company**, and the quotes created since, then resets
the numbering, so: load, test, broom, and load again live in front of the
prospect. It leaves other companies' jobs and any customer it didn't load
alone, because other demo profiles share the site.

Needs the eight default stages and a Company.

### Demo script (about 5 minutes)

0. **Load demo jobs** live on the empty board.
1. **Quotes** — their own register: pipeline, follow-ups due. Mark AT1420
   **Won**: PO, tick delivery and installation, Create Job → JOB-356 opens on
   the board with milestones and Customer Ready checks. Nothing retyped.
2. **By Person** — Rick's table: Paul is on JOB-350, next JOB-351; Jason is
   on JOB-348 (overdue, held up on a material spec), next JOB-352; Carla is on
   JOB-354, next JOB-355.
3. **Held Up / Overdue / Due 7 Days tiles** — one tap each.
4. **By Stage** — JOB-350 sits in Drawing Approval, held up awaiting the
   customer. Drag it to Procurement: it is **refused** because no drawing is
   approved. Control without admin.
5. Tap JOB-350: the panel shows the lock and why. Open Rev B (the eye) to
   show the GA sheet, then tap **Client approved** on it.
6. **Hand over to Procurement**: Thandi is already filled in; add a note.
   The held-up line clears, Thandi gets an alert, the history records it.
   Nothing typed twice.
7. JOB-349 in Procurement shows the gearbox as **long-lead to order**; tap it
   through Ordered to Received and everyone on the job is told. JOB-353 in QC / FAT: one tap on
   **QC / FAT passed** and it can be released. JOB-346 in Customer Ready waits
   on its ready checks.
8. On a phone: same board, one stage per screen, tap a card for the panel.
