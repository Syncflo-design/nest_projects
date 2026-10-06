"""Job fields on Project and the default board stages."""

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

# Board columns, left to right. Seeded once on a fresh site; after that the
# Job Stage list is the client's to change.
DEFAULT_STAGES = [
	{"stage_name": "Order", "color": "Blue"},
	{"stage_name": "Engineering", "color": "Purple"},
	{"stage_name": "Drawing Approval", "color": "Amber", "gate": "Drawing approved"},
	{"stage_name": "Procurement", "color": "Orange"},
	{"stage_name": "Production", "color": "Teal"},
	{"stage_name": "QC / FAT", "color": "Pink", "gate": "QC checks complete"},
	{"stage_name": "Customer Ready", "color": "Green", "gate": "Ready checks complete"},
	{"stage_name": "Invoiced", "color": "Gray", "is_closed": 1},
]

# Project already carries customer, priority and expected_end_date (the due
# date); these are only what it lacks.
CUSTOM_FIELDS = {
	"Project": [
		{
			"fieldname": "job_tab",
			"label": "Job",
			"fieldtype": "Tab Break",
			"insert_after": "actual_end_date",
		},
		{
			"fieldname": "job_stage",
			"label": "Stage",
			"fieldtype": "Link",
			"options": "Job Stage",
			"insert_after": "job_tab",
			"in_list_view": 1,
			"in_standard_filter": 1,
		},
		{
			"fieldname": "job_owner",
			"label": "Responsible",
			"fieldtype": "Link",
			"options": "User",
			"insert_after": "job_stage",
			"in_list_view": 1,
			"in_standard_filter": 1,
			"description": "The person working this job in its current stage.",
		},
		{
			"fieldname": "job_work_status",
			"label": "Progress",
			"fieldtype": "Select",
			"options": "Queued\nIn Progress",
			"default": "Queued",
			"insert_after": "job_owner",
			"description": "In Progress = what they are working on now. Queued = waiting its turn.",
		},
		{
			"fieldname": "job_stage_since",
			"label": "In Stage Since",
			"fieldtype": "Datetime",
			"insert_after": "job_work_status",
			"read_only": 1,
			"no_copy": 1,
		},
		{
			"fieldname": "job_column_1",
			"fieldtype": "Column Break",
			"insert_after": "job_stage_since",
		},
		{
			"fieldname": "job_quote_ref",
			"label": "Quote No",
			"fieldtype": "Data",
			"insert_after": "job_column_1",
			"in_standard_filter": 1,
		},
		{
			"fieldname": "job_customer_po",
			"label": "Customer PO",
			"fieldtype": "Data",
			"insert_after": "job_quote_ref",
		},
		{
			"fieldname": "job_site",
			"label": "Site",
			"fieldtype": "Data",
			"insert_after": "job_customer_po",
		},
		{
			"fieldname": "job_warehouse",
			"label": "Site Store",
			"fieldtype": "Link",
			"options": "Warehouse",
			"insert_after": "job_site",
			"description": "The job's own store at site. Created automatically when the job gets a stage.",
		},
		{
			"fieldname": "job_blocker",
			"label": "Held Up By",
			"fieldtype": "Small Text",
			"insert_after": "job_warehouse",
			"description": "What is stopping this job moving. Leave empty when nothing is.",
		},
		{
			"fieldname": "job_drawings_section",
			"label": "Drawings",
			"fieldtype": "Section Break",
			"insert_after": "job_blocker",
		},
		{
			"fieldname": "job_drawing_not_required",
			"label": "No customer drawing approval needed",
			"fieldtype": "Check",
			"insert_after": "job_drawings_section",
		},
		{
			"fieldname": "job_drawings",
			"label": "Drawings",
			"fieldtype": "Table",
			"options": "Job Drawing",
			"insert_after": "job_drawing_not_required",
		},
		{
			"fieldname": "job_materials_section",
			"label": "Materials",
			"fieldtype": "Section Break",
			"insert_after": "job_drawings",
		},
		{
			"fieldname": "job_materials",
			"label": "Materials",
			"fieldtype": "Table",
			"options": "Job Material",
			"insert_after": "job_materials_section",
		},
		{
			"fieldname": "job_qc_section",
			"label": "QC / FAT Checks",
			"fieldtype": "Section Break",
			"insert_after": "job_materials",
		},
		{
			"fieldname": "job_qc_checks",
			"label": "Checks",
			"fieldtype": "Table",
			"options": "Job QC Check",
			"insert_after": "job_qc_section",
		},
		{
			"fieldname": "job_ready_section",
			"label": "Customer Ready Checks",
			"fieldtype": "Section Break",
			"insert_after": "job_qc_checks",
			"description": "Built from the Order Face ticks when the quote is won (packaging, delivery, installation, safety file, sub-contractor).",
		},
		{
			"fieldname": "job_ready_checks",
			"label": "Checks",
			"fieldtype": "Table",
			"options": "Job Ready Check",
			"insert_after": "job_ready_section",
		},
		{
			"fieldname": "job_milestones_section",
			"label": "Payment Milestones",
			"fieldtype": "Section Break",
			"insert_after": "job_ready_checks",
		},
		{
			"fieldname": "job_milestones",
			"label": "Milestones",
			"fieldtype": "Table",
			"options": "Job Milestone",
			"insert_after": "job_milestones_section",
		},
		{
			"fieldname": "job_log_section",
			"label": "Stage History",
			"fieldtype": "Section Break",
			"insert_after": "job_milestones",
			"collapsible": 1,
		},
		{
			"fieldname": "job_stage_log",
			"label": "Stage History",
			"fieldtype": "Table",
			"options": "Job Stage Log",
			"insert_after": "job_log_section",
			"read_only": 1,
			"no_copy": 1,
		},
		{
			"fieldname": "job_is_demo",
			"label": "Demo Job",
			"fieldtype": "Check",
			"insert_after": "job_stage_log",
			"hidden": 1,
			"read_only": 1,
			"no_copy": 1,
		},
	],
}


def ensure_setup():
	create_custom_fields(CUSTOM_FIELDS, ignore_validate=True)
	seed_stages()
	frappe.db.commit()


def seed_stages():
	if frappe.db.count("Job Stage"):
		return
	for i, stage in enumerate(DEFAULT_STAGES, start=1):
		frappe.get_doc({"doctype": "Job Stage", "sequence": i * 10, **stage}).insert(ignore_permissions=True)
