app_name        = "nest_projects"
app_title       = "Nest Projects"
app_publisher   = "NestERP / Syncflo"
app_description = "Job board for engineer-to-order work: every project on one Kanban board, from order to customer ready."
app_email       = "ops@syncflo.co.za"
app_license     = "MIT"
app_icon        = "octicon octicon-project"

required_apps = ["erpnext"]

# Job fields on Project and the default stages. Re-applied on every migrate so
# a field change here reaches existing sites without a manual step.
after_install = "nest_projects.install.ensure_setup"
after_migrate = "nest_projects.install.ensure_setup"

# Gates, stage history and handover alerts. On the doc events (not the board
# API) so a stage changed on the Project form obeys the same rules.
# Offers the demo jobs to the Nest Demo switch on the demo site (ignored elsewhere).
nest_demo_loaders = [
	{
		"key": "nest_projects",
		"label": "Engineer-to-order workshop: 11 jobs, 37 quotes, 6 people",
		"load": "nest_projects.demo.load_demo",
		"remove": "nest_projects.demo.remove_demo",
		"is_loaded": "nest_projects.demo.is_loaded",
	}
]

doc_events = {
	"Project": {
		"validate": "nest_projects.jobs.validate_project",
		# Alert the new person; give a job on the board its own site store.
		"on_update": ["nest_projects.jobs.notify_owner", "nest_projects.stock.ensure_job_store"],
	},
	# The job's material lines follow the purchase order raised for them.
	"Purchase Order": {
		"on_submit": "nest_projects.purchasing.po_submitted",
		"on_cancel": "nest_projects.purchasing.po_released",
		"on_trash": "nest_projects.purchasing.po_released",
	},
	"Purchase Receipt": {
		"on_submit": "nest_projects.purchasing.receipt_submitted",
		"on_cancel": "nest_projects.purchasing.receipt_cancelled",
	},
}
