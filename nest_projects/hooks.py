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
doc_events = {
	"Project": {
		"validate": "nest_projects.jobs.validate_project",
		"on_update": "nest_projects.jobs.notify_owner",
	}
}
