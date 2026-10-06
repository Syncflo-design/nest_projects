"""Job panel: one job in full, and the one-tap actions on it.

Every action saves the Project (so gates, history and alerts behave exactly as
on the form) and returns the refreshed job, so the panel redraws in one trip.
"""

import frappe
from frappe import _

from nest_projects.jobs import CHECK_TABLES, gate_failure

DRAWING_STATUSES = ("Draft", "Sent for Approval", "Approved", "Superseded")
MATERIAL_STATUSES = ("In Stock", "To Order", "Ordered", "Received")


@frappe.whitelist()
def get_job(project):
	doc = frappe.get_doc("Project", project)
	doc.check_permission("read")
	return job_payload(doc)


@frappe.whitelist()
def set_blocker(project, text=None):
	doc = writable(project)
	doc.job_blocker = (text or "").strip() or None
	return save(doc)


@frappe.whitelist()
def set_drawing_status(project, row, status):
	if status not in DRAWING_STATUSES:
		frappe.throw(_("Unknown drawing status {0}.").format(status))
	doc = writable(project)
	child(doc, "job_drawings", row).status = status
	return save(doc)


@frappe.whitelist()
def add_drawing(project, drawing_no, revision, title=None, file_url=None):
	"""A new revision; earlier live revisions of the same drawing become Superseded."""
	drawing_no = (drawing_no or "").strip()
	revision = (revision or "").strip()
	if not drawing_no or not revision:
		frappe.throw(_("Drawing number and revision are both needed."))
	doc = writable(project)
	for row in doc.get("job_drawings") or []:
		if row.drawing_no == drawing_no and row.status != "Superseded":
			row.status = "Superseded"
	doc.append(
		"job_drawings",
		{"drawing_no": drawing_no, "revision": revision, "title": title, "file": file_url, "status": "Draft"},
	)
	return save(doc)


@frappe.whitelist()
def set_material_status(project, row, status):
	if status not in MATERIAL_STATUSES:
		frappe.throw(_("Unknown material status {0}.").format(status))
	doc = writable(project)
	child(doc, "job_materials", row).status = status
	return save(doc)


@frappe.whitelist()
def set_check(project, row, done, table="job_qc_checks"):
	"""Ticks a QC / FAT check or a Customer Ready check."""
	if table not in CHECK_TABLES:
		frappe.throw(_("Unknown checklist."))
	doc = writable(project)
	child(doc, table, row).done = 1 if frappe.utils.cint(done) else 0
	return save(doc)


@frappe.whitelist()
def mark_invoiced(project, row, invoice_ref=None):
	doc = writable(project)
	milestone = child(doc, "job_milestones", row)
	milestone.invoiced = 1
	milestone.invoice_ref = (invoice_ref or "").strip() or None
	return save(doc)


def job_payload(doc):
	stages = frappe.get_all(
		"Job Stage", fields=["name", "sequence", "color", "gate", "is_closed", "default_owner"], order_by="sequence asc"
	)
	names = [s.name for s in stages]
	here = names.index(doc.job_stage) if doc.job_stage in names else -1
	current = stages[here] if here >= 0 else None
	next_stage = stages[here + 1] if 0 <= here < len(stages) - 1 and not current.is_closed else None
	previous = stages[here - 1] if here > 0 else None

	people = {doc.job_owner} | {r.to_owner for r in doc.job_stage_log} | {r.moved_by for r in doc.job_stage_log}
	people |= {r.done_by for r in doc.job_qc_checks} | {r.done_by for r in doc.job_ready_checks}
	users = {
		u.name: {"full_name": u.full_name or u.name, "image": u.user_image}
		for u in frappe.get_all(
			"User", filters={"name": ["in", [p for p in people if p]]}, fields=["name", "full_name", "user_image"]
		)
	}

	def rows(table, fields):
		return [{"name": r.name, **{f: r.get(f) for f in fields}} for r in doc.get(table) or []]

	return {
		"name": doc.name,
		"project_name": doc.project_name,
		"customer": doc.customer,
		"site": doc.job_site,
		"quote": doc.job_quote_ref,
		"po": doc.job_customer_po,
		"priority": doc.priority,
		"due": doc.expected_end_date,
		"scope": frappe.utils.strip_html(doc.notes or "").strip(),
		"stage": doc.job_stage,
		"stage_since": doc.job_stage_since,
		"owner": doc.job_owner,
		"work_status": doc.job_work_status,
		"blocker": doc.job_blocker,
		"drawing_not_required": doc.job_drawing_not_required,
		"drawings": rows("job_drawings", ["drawing_no", "revision", "title", "file", "status", "approved_on"]),
		"materials": rows("job_materials", ["item", "description", "qty", "status", "expected_on"]),
		"checks": rows("job_qc_checks", ["check", "done", "done_by", "done_on", "notes"]),
		"ready_checks": rows("job_ready_checks", ["check", "done", "done_by", "done_on", "notes"]),
		"milestones": rows("job_milestones", ["label", "percent", "due_at_stage", "invoiced", "invoice_ref"]),
		"history": list(reversed(rows("job_stage_log", ["from_stage", "to_stage", "to_owner", "moved_by", "moved_on", "note"]))),
		"next_stage": next_stage.name if next_stage else None,
		"previous_stage": previous.name if previous and not (current and current.is_closed) else None,
		# Why the job can't move forward yet, if it can't.
		"gate_block": gate_failure(doc, current.gate) if current and current.gate and next_stage else None,
		"stage_order": {s.name: s.sequence for s in stages},
		"users": users,
		"can_write": bool(frappe.has_permission("Project", "write", doc)),
	}


def writable(project):
	doc = frappe.get_doc("Project", project)
	doc.check_permission("write")
	return doc


def child(doc, table, name):
	for row in doc.get(table) or []:
		if row.name == name:
			return row
	frappe.throw(_("That line is no longer on {0}. Refresh and try again.").format(doc.name))


def save(doc):
	doc.save()
	return job_payload(doc)
