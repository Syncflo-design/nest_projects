"""Job board data and actions."""

import frappe
from frappe import _
from frappe.utils import today

JOB_FIELDS = [
	"name",
	"project_name",
	"customer",
	"priority",
	"expected_end_date",
	"job_stage",
	"job_owner",
	"job_work_status",
	"job_stage_since",
	"job_quote_ref",
	"job_customer_po",
	"job_site",
	"job_blocker",
	"job_drawing_not_required",
]


@frappe.whitelist()
def get_board():
	"""Everything the board draws in one call: stages, jobs with their summaries, people."""
	stages = frappe.get_all(
		"Job Stage",
		fields=["name", "sequence", "color", "gate", "is_closed", "default_owner", "owner_role"],
		order_by="sequence asc",
	)
	jobs = frappe.get_list(
		"Project",
		filters=[["job_stage", "is", "set"], ["status", "!=", "Cancelled"]],
		fields=JOB_FIELDS,
		limit_page_length=0,
	)
	if jobs:
		attach_summaries(jobs, stages)

	people = {j.job_owner for j in jobs if j.job_owner} | {s.default_owner for s in stages if s.default_owner}
	users = {}
	if people:
		for u in frappe.get_all(
			"User", filters={"name": ["in", list(people)]}, fields=["name", "full_name", "user_image"]
		):
			users[u.name] = {"full_name": u.full_name or u.name, "image": u.user_image}

	return {
		"stages": stages,
		"jobs": jobs,
		"users": users,
		"me": frappe.session.user,
		"today": today(),
		# A Projects Manager can load the demo (the live opening); only a System Manager clears it.
		"can_demo": bool({"System Manager", "Projects Manager"} & set(frappe.get_roles())),
		"can_remove_demo": "System Manager" in frappe.get_roles(),
		"has_demo": bool(frappe.db.exists("Project", {"job_is_demo": 1})),
	}


@frappe.whitelist()
def move_job(project, to_stage, owner=None, note=None):
	"""The handover: puts a job in another stage with a new responsible person.

	Gates, the stage history and the alert to the new person run in the Project
	doc events, so the form and the board behave the same.
	"""
	if not frappe.db.exists("Job Stage", to_stage):
		frappe.throw(_("Stage {0} does not exist.").format(to_stage))
	doc = frappe.get_doc("Project", project)
	doc.check_permission("write")
	if doc.job_stage == to_stage:
		return
	sequence = dict(frappe.get_all("Job Stage", fields=["name", "sequence"], as_list=True))
	forward = sequence.get(to_stage, 0) > sequence.get(doc.job_stage, 0)

	doc.flags.job_move_note = (note or "").strip() or None
	doc.job_stage = to_stage
	doc.job_owner = owner or None
	doc.job_work_status = "Queued"
	if forward:
		# Whatever held it up in the old stage is behind it now.
		doc.job_blocker = None
	doc.save()


@frappe.whitelist()
def assign_job(project, owner=None):
	"""Gives a job to someone else in the same stage (By Person view drag)."""
	doc = frappe.get_doc("Project", project)
	doc.check_permission("write")
	owner = owner or None
	if (doc.job_owner or None) == owner:
		return
	doc.job_owner = owner
	doc.job_work_status = "Queued"
	doc.save()


@frappe.whitelist()
def set_work_status(project, status):
	"""On it / Queued: what the responsible person is working on right now."""
	if status not in ("Queued", "In Progress"):
		frappe.throw(_("Unknown progress {0}.").format(status))
	doc = frappe.get_doc("Project", project)
	doc.check_permission("write")
	doc.job_work_status = status
	doc.save()


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def stage_users(doctype, txt, searchfield, start, page_len, filters):
	"""People who can take a job in a stage: those with the stage's role, or anyone if it has none."""
	role = frappe.db.get_value("Job Stage", (filters or {}).get("stage"), "owner_role")
	user = frappe.qb.DocType("User")
	query = (
		frappe.qb.from_(user)
		.select(user.name, user.full_name)
		.where(user.enabled == 1)
		.where(user.user_type == "System User")
		.where((user.name.like(f"%{txt}%")) | (user.full_name.like(f"%{txt}%")))
		.orderby(user.full_name)
		.limit(page_len)
		.offset(start)
	)
	if role:
		has_role = frappe.qb.DocType("Has Role")
		query = query.where(
			user.name.isin(
				frappe.qb.from_(has_role)
				.select(has_role.parent)
				.where(has_role.parenttype == "User")
				.where(has_role.role == role)
			)
		)
	return query.run()


def attach_summaries(jobs, stages):
	"""Adds the small facts a card shows: drawing, materials, QC and what's ready to invoice."""
	names = [j.name for j in jobs]
	sequence = {s.name: s.sequence for s in stages}
	drawings = child_rows("Job Drawing", names, ["drawing_no", "revision", "status"])
	materials = child_rows("Job Material", names, ["status"])
	checks = child_rows("Job QC Check", names, ["done"])
	ready_checks = child_rows("Job Ready Check", names, ["done"])
	milestones = child_rows("Job Milestone", names, ["label", "percent", "due_at_stage", "invoiced"])

	for job in jobs:
		# The card shows the main drawing: the first one still live (older revisions are superseded).
		live = [d for d in drawings.get(job.name, []) if d.status != "Superseded"]
		latest = live[0] if live else None
		job.drawing = (
			{
				"no": latest.drawing_no,
				"rev": latest.revision,
				"status": latest.status,
				"approved": any(d.status == "Approved" for d in live),
			}
			if latest
			else None
		)

		mats = materials.get(job.name, [])
		job.materials = {
			"total": len(mats),
			"to_order": sum(1 for m in mats if m.status == "To Order"),
			"on_order": sum(1 for m in mats if m.status in ("Requested", "Ordered")),
		}

		qc = checks.get(job.name, [])
		job.qc = {"total": len(qc), "done": sum(1 for c in qc if c.done)}
		rc = ready_checks.get(job.name, [])
		job.ready = {"total": len(rc), "done": sum(1 for c in rc if c.done)}

		# A milestone is ready to invoice once the job has left the stage it is tied to.
		here = sequence.get(job.job_stage, 0)
		ready = [
			m
			for m in milestones.get(job.name, [])
			if not m.invoiced and m.due_at_stage and sequence.get(m.due_at_stage, 0) < here
		]
		job.to_invoice = {"percent": sum(m.percent or 0 for m in ready), "labels": [m.label for m in ready]}


def child_rows(doctype, names, fields):
	rows = frappe.get_all(
		doctype,
		filters={"parenttype": "Project", "parent": ["in", names]},
		fields=["parent", *fields],
		order_by="idx asc",
	)
	grouped = {}
	for row in rows:
		grouped.setdefault(row.parent, []).append(row)
	return grouped
