"""Project doc events: stage gates, stage history and handover alerts.

Run on every save, so a stage change made on the form obeys the same rules as
one made on the board.
"""

import frappe
from frappe import _
from frappe.utils import now_datetime, today

DRAWING_GATE = "Drawing approved"
QC_GATE = "QC checks complete"
READY_GATE = "Ready checks complete"
CHECK_TABLES = ("job_qc_checks", "job_ready_checks")


def validate_project(doc, method=None):
	stamp_checks(doc)
	if doc.flags.get("job_demo_load"):
		# The demo loader writes its own back-dated history.
		return
	before = doc.get_doc_before_save()
	old_stage = (before.job_stage if before else None) or None
	old_owner = (before.job_owner if before else None) or None
	stage = doc.job_stage or None
	stage_moved = stage != old_stage
	owner_moved = (doc.job_owner or None) != old_owner

	if stage_moved and old_stage and stage:
		check_gates(doc, old_stage, stage)
	if stage_moved:
		doc.job_stage_since = now_datetime() if stage else None
	# History covers every handover: a new stage, or a new person in the same stage.
	if not (stage_moved or (owner_moved and stage)):
		return
	doc.append(
		"job_stage_log",
		{
			"from_stage": old_stage,
			"to_stage": stage,
			"to_owner": doc.job_owner or None,
			"moved_by": frappe.session.user,
			"moved_on": now_datetime(),
			"note": doc.flags.get("job_move_note") or (None if stage_moved else _("Reassigned")),
		},
	)


def notify_owner(doc, method=None):
	"""Tells the responsible person a job has landed with them."""
	owner = doc.job_owner
	if not owner or owner == frappe.session.user or not doc.job_stage or doc.flags.get("job_demo_load"):
		return
	if not (doc.has_value_changed("job_owner") or doc.has_value_changed("job_stage")):
		return
	note = doc.flags.get("job_move_note")
	frappe.get_doc(
		{
			"doctype": "Notification Log",
			"for_user": owner,
			"from_user": frappe.session.user,
			"type": "Alert",
			"document_type": "Project",
			"document_name": doc.name,
			"subject": _("{0} is with you in {1}").format(frappe.bold(doc.project_name or doc.name), doc.job_stage),
			"email_content": note or "",
		}
	).insert(ignore_permissions=True)


def stamp_checks(doc):
	"""Who ticked a QC or ready check and when; when a drawing was approved."""
	for table in CHECK_TABLES:
		for row in doc.get(table) or []:
			if row.done and not row.done_by:
				row.done_by = frappe.session.user
				row.done_on = now_datetime()
			elif not row.done:
				row.done_by = None
				row.done_on = None
	for row in doc.get("job_drawings") or []:
		if row.status == "Approved" and not row.approved_on:
			row.approved_on = today()


def check_gates(doc, old, new):
	"""Blocks a forward move past any stage whose gate isn't met. Moving back is always allowed."""
	sequence = dict(frappe.get_all("Job Stage", fields=["name", "sequence"], as_list=True))
	start, end = sequence.get(old, 0), sequence.get(new, 0)
	if end <= start:
		return
	gated = frappe.get_all(
		"Job Stage",
		filters=[["sequence", ">=", start], ["sequence", "<", end], ["gate", "is", "set"]],
		fields=["name", "gate"],
		order_by="sequence asc",
	)
	for stage in gated:
		reason = gate_failure(doc, stage.gate)
		if reason:
			frappe.throw(_("Can't leave {0} yet: {1}").format(stage.name, reason), title=_("Not Ready"))


def gate_failure(doc, gate):
	if gate == DRAWING_GATE:
		if doc.job_drawing_not_required:
			return None
		if any(d.status == "Approved" for d in doc.get("job_drawings") or []):
			return None
		return _("no drawing has been approved by the customer.")
	if gate in (QC_GATE, READY_GATE):
		qc = gate == QC_GATE
		checks = doc.get("job_qc_checks" if qc else "job_ready_checks") or []
		done = sum(1 for c in checks if c.done)
		if not checks:
			# No QC listed is a gap; no ready checks just means nothing to arrange.
			return _("no QC checks have been listed.") if qc else None
		if done < len(checks):
			return (_("{0} of {1} QC checks are done.") if qc else _("{0} of {1} customer ready checks are done.")).format(
				done, len(checks)
			)
	return None


def default_company():
	company = (
		frappe.defaults.get_user_default("Company")
		or frappe.db.get_single_value("Global Defaults", "default_company")
		or frappe.db.get_value("Company", {}, "name")
	)
	if not company:
		frappe.throw(_("Create a Company first."))
	return company


def ensure_customer(title):
	"""The Customer with this name, created if there isn't one."""
	name = frappe.db.get_value("Customer", {"customer_name": title})
	if name:
		return name
	group = frappe.db.get_single_value("Selling Settings", "customer_group") or frappe.db.get_value(
		"Customer Group", {"is_group": 0}
	)
	territory = frappe.db.get_single_value("Selling Settings", "territory") or frappe.db.get_value(
		"Territory", {"is_group": 0}
	)
	return (
		frappe.get_doc(
			{
				"doctype": "Customer",
				"customer_name": title,
				"customer_type": "Company",
				"customer_group": group,
				"territory": territory,
			}
		)
		.insert(ignore_permissions=True)
		.name
	)
