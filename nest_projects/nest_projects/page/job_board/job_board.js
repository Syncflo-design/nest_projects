// nest_projects — Job Board. Every job (a Project with a stage) on one Kanban
// board; dragging a card to another column is the handover.
// Desk Page: mounts inside page.body (jQuery in v16) per CoWork_Helper gotcha
// 2026-05-10. HTML is built as string arrays joined with "\n" (page-bundle rule).
// Bump BUILD_MARKER with every CSS change (gotcha 2026-08-18).

frappe.pages['job-board'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({ parent: wrapper, title: __('Job Board'), single_column: true });

	var BUILD_MARKER = 'v0.0.2-2026-10-06-board';
	console.log('Job Board loaded:', BUILD_MARKER);

	[
		['jb-stylesheet', '/assets/nest_projects/css/job_board.css'],
		['jb-phosphor', '/assets/nest_projects/vendor/phosphor/style.css']
	].forEach(function(css) {
		if (document.getElementById(css[0])) return;
		var link = document.createElement('link');
		link.id = css[0];
		link.rel = 'stylesheet';
		link.href = css[1] + '?v=' + encodeURIComponent(BUILD_MARKER);
		document.head.appendChild(link);
	});

	wrapper.jobBoard = new JobBoard(page);
};

frappe.pages['job-board'].on_page_show = function(wrapper) {
	if (wrapper.jobBoard) wrapper.jobBoard.refresh();
};

// ---------------------------------------------------------------------------

var JB_STAGE_COLORS = {
	Blue: '#3b82f6', Purple: '#8b5cf6', Amber: '#f59e0b', Teal: '#14b8a6',
	Orange: '#f97316', Pink: '#ec4899', Green: '#22c55e', Gray: '#94a3b8'
};
var JB_AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#22c55e'];
var JB_GATE_TEXT = {
	'Drawing approved': __("Can't leave until a drawing is approved"),
	'QC checks complete': __("Can't leave until every QC check is done")
};
var JB_FILTERS = [
	{ key: 'all',     label: __('Active Jobs') },
	{ key: 'mine',    label: __('With Me') },
	{ key: 'held',    label: __('Held Up'),   tone: 'bad' },
	{ key: 'over',    label: __('Overdue'),   tone: 'bad' },
	{ key: 'soon',    label: __('Due 7 Days'), tone: 'warn' },
	{ key: 'invoice', label: __('To Invoice'), tone: 'good' }
];
var JB_SOON_DAYS = 7;

function jb_esc(s) {
	var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
	return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return map[c]; });
}

function jb_initials(name) {
	var parts = String(name || '?').trim().split(/\s+/);
	return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function jb_hash_color(key) {
	var h = 0;
	for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
	return JB_AVATAR_COLORS[h % JB_AVATAR_COLORS.length];
}

class JobBoard {

	constructor(page) {
		this.page = page;
		this.data = null;
		this.filter = 'all';
		this.query = '';
		this.drag_name = null;
		this.refresh_timer = null;

		// v16: page.body is jQuery; create our own container (gotcha 2026-05-10, Variant 2).
		this.$main = $('<div class="jb-root"></div>').appendTo(page.body);
		var $head = page.head ? $(page.head) : $(page.wrapper).find('.page-head');
		if ($head && $head.length) $head.hide();

		this.render_shell();
		this.bind_events();
		this.listen();
		this.refresh();
	}

	// ---- Data -------------------------------------------------------------

	refresh() {
		var me = this;
		return frappe.call({ method: 'nest_projects.api.get_board' }).then(function(r) {
			me.data = me.prepare(r.message || {});
			me.render();
		});
	}

	// Coalesces bursts of realtime updates (our own moves included) into one reload.
	schedule_refresh() {
		var me = this;
		clearTimeout(this.refresh_timer);
		this.refresh_timer = setTimeout(function() {
			if (me.$main.is(':visible')) me.refresh();
		}, 800);
	}

	listen() {
		var me = this;
		try {
			frappe.realtime.doctype_subscribe('Project');
			frappe.realtime.on('list_update', function(d) {
				if (d && d.doctype === 'Project') me.schedule_refresh();
			});
		} catch (e) { /* realtime is a nicety; the poll below covers it */ }
		setInterval(function() { me.schedule_refresh(); }, 60000);
	}

	prepare(d) {
		var me = this;
		d.stages = d.stages || [];
		d.jobs = d.jobs || [];
		d.users = d.users || {};
		d.stage_map = {};
		d.stages.forEach(function(s, i) {
			s.hex = JB_STAGE_COLORS[s.color] || JB_STAGE_COLORS.Blue;
			s.index = i;
			d.stage_map[s.name] = s;
		});
		var today = moment(d.today);
		d.jobs.forEach(function(j) {
			var stage = d.stage_map[j.job_stage] || {};
			j.closed = !!stage.is_closed;
			j.days_left = j.expected_end_date ? moment(j.expected_end_date).diff(today, 'days') : null;
			j.over = !j.closed && j.days_left !== null && j.days_left < 0;
			j.soon = !j.closed && j.days_left !== null && j.days_left >= 0 && j.days_left <= JB_SOON_DAYS;
			j.held = !j.closed && !!(j.job_blocker || '').trim();
			j.mine = !j.closed && j.job_owner === d.me;
			j.invoice = !!(j.to_invoice && j.to_invoice.percent);
			j.owner_name = j.job_owner ? ((d.users[j.job_owner] || {}).full_name || j.job_owner) : '';
			j.search = [j.name, j.project_name, j.customer, j.job_site, j.job_quote_ref, j.job_customer_po, j.owner_name]
				.join(' ').toLowerCase();
		});
		d.jobs.sort(me.compare);
		return d;
	}

	// High priority first, then soonest due date (undated last), then job number.
	compare(a, b) {
		var pa = a.priority === 'High' ? 0 : 1, pb = b.priority === 'High' ? 0 : 1;
		if (pa !== pb) return pa - pb;
		var da = a.expected_end_date || '9999', db = b.expected_end_date || '9999';
		if (da !== db) return da < db ? -1 : 1;
		return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
	}

	matches(j) {
		if (this.query && j.search.indexOf(this.query) === -1) return false;
		if (this.filter === 'all') return true;
		return !!j[this.filter];
	}

	// ---- Rendering --------------------------------------------------------

	render_shell() {
		this.$main.html([
			'<div class="jb-app">',
			'  <div class="jb-header">',
			'    <div>',
			'      <div class="jb-title"><i class="ph ph-kanban"></i>' + __('Job Board') + '</div>',
			'      <div class="jb-sub" id="jb-sub"></div>',
			'    </div>',
			'    <div class="jb-stats" id="jb-stats"></div>',
			'  </div>',
			'  <div class="jb-toolbar">',
			'    <label class="jb-search"><i class="ph ph-magnifying-glass"></i>',
			'      <input id="jb-q" type="search" autocomplete="off" placeholder="' + __('Search job, customer, site, person') + '"></label>',
			'    <span class="jb-filter-note" id="jb-filter-note"></span>',
			'    <button class="jb-iconbtn jb-push" id="jb-refresh" title="' + __('Refresh') + '"><i class="ph ph-arrows-clockwise"></i></button>',
			'  </div>',
			'  <div class="jb-stagebar" id="jb-stagebar"></div>',
			'  <div class="jb-board" id="jb-board"></div>',
			'</div>'
		].join('\n'));
	}

	render() {
		var d = this.data;
		var me = this;
		if (!d) return;

		var active = d.jobs.filter(function(j) { return !j.closed; });
		$('#jb-sub', this.$main).html(
			jb_esc(__('{0} jobs across {1} stages.', [active.length, d.stages.length])) + ' ' +
			'<span class="jb-hint-desk">' + __('Drag a card to hand it over.') + '</span>' +
			'<span class="jb-hint-phone">' + __('Tap the arrow on a card to hand it over.') + '</span>'
		);

		// Stat tiles: the counts are the filters.
		var counts = {};
		JB_FILTERS.forEach(function(f) {
			counts[f.key] = f.key === 'all' ? active.length : d.jobs.filter(function(j) { return j[f.key]; }).length;
		});
		$('#jb-stats', this.$main).html(JB_FILTERS.map(function(f) {
			return [
				'<button class="jb-stat' + (f.tone ? ' jb-s-' + f.tone : '') + (me.filter === f.key ? ' active' : '') + '" data-filter="' + f.key + '">',
				'  <div class="jb-stat-n">' + counts[f.key] + '</div>',
				'  <div class="jb-stat-l">' + jb_esc(f.label) + '</div>',
				'</button>'
			].join('\n');
		}).join('\n'));

		var current = JB_FILTERS.filter(function(f) { return f.key === me.filter; })[0];
		$('#jb-filter-note', this.$main).html(this.filter === 'all' ? '' :
			__('Showing: {0}', [jb_esc(current.label)]) + '<a data-filter="all">' + __('Show all') + '</a>');

		var visible = d.jobs.filter(function(j) { return me.matches(j); });
		var by_stage = {};
		visible.forEach(function(j) { (by_stage[j.job_stage] = by_stage[j.job_stage] || []).push(j); });

		$('#jb-stagebar', this.$main).html(d.stages.map(function(s) {
			return '<span class="jb-chip-stage" data-goto="' + jb_esc(s.name) + '" style="--jb-stage:' + s.hex + '">' +
				'<span class="jb-dot"></span>' + jb_esc(s.name) + ' <b>' + (by_stage[s.name] || []).length + '</b></span>';
		}).join(''));

		$('#jb-board', this.$main).html(d.stages.map(function(s) {
			return me.render_column(s, by_stage[s.name] || []);
		}).join('\n'));
	}

	render_column(stage, jobs) {
		var me = this;
		var shown = jobs;
		var more = 0;
		if (stage.is_closed) {
			// Finished jobs: only the most recent few, newest first.
			shown = jobs.slice().sort(function(a, b) {
				return (b.job_stage_since || '') < (a.job_stage_since || '') ? -1 : 1;
			}).slice(0, 6);
			more = jobs.length - shown.length;
		}
		var gate = stage.gate ? '<i class="ph ph-lock-simple jb-gate" title="' + jb_esc(JB_GATE_TEXT[stage.gate] || stage.gate) + '"></i>' : '';
		var body = shown.length ? shown.map(function(j) { return me.render_card(j, stage); }).join('\n')
			: '<div class="jb-empty">' + __('Nothing here') + '</div>';
		if (more > 0) body += '<div class="jb-empty">' + __('+ {0} more finished', [more]) + '</div>';

		return [
			'<div class="jb-col' + (stage.is_closed ? ' jb-closed' : '') + '" data-col="' + jb_esc(stage.name) + '" style="--jb-stage:' + stage.hex + '">',
			'  <div class="jb-col-head"><span class="jb-dot"></span><span class="jb-col-name">' + jb_esc(stage.name) + '</span>' + gate +
			'<span class="jb-count">' + jobs.length + '</span></div>',
			'  <div class="jb-col-body" data-stage="' + jb_esc(stage.name) + '">' + body + '</div>',
			'</div>'
		].join('\n');
	}

	render_card(j, stage) {
		var d = this.data;
		var next = d.stages[stage.index + 1];

		var due = '';
		if (j.expected_end_date) {
			var cls = j.over ? ' jb-over' : (j.soon ? ' jb-soon' : '');
			var tip = j.over ? __('{0} days overdue', [-j.days_left]) : (j.days_left === 0 ? __('Due today') : __('Due in {0} days', [j.days_left]));
			due = '<span class="jb-due' + cls + '" title="' + jb_esc(tip) + '"><i class="ph ph-calendar-blank"></i>' +
				jb_esc(moment(j.expected_end_date).format('D MMM')) + '</span>';
		}

		var where = [j.customer, j.job_site].filter(Boolean).map(jb_esc).join(' &middot; ');
		var title = j.project_name && j.project_name !== j.name ? j.project_name : (j.customer || '');

		return [
			'<div class="jb-card' + (j.held ? ' jb-held' : '') + '" draggable="true" data-name="' + jb_esc(j.name) + '">',
			'  <div class="jb-card-top"><span class="jb-jobno">' + jb_esc(j.name) + '</span>' +
				(j.priority === 'High' ? '<i class="ph ph-flag jb-prio" title="' + __('High priority') + '"></i>' : '') + due + '</div>',
			'  <div class="jb-card-title">' + jb_esc(title) + '</div>',
			where ? '  <div class="jb-card-cust"><i class="ph ph-buildings"></i>' + where + '</div>' : '',
			j.held ? '  <div class="jb-block"><i class="ph ph-warning-octagon"></i><span>' + jb_esc(j.job_blocker) + '</span></div>' : '',
			this.render_tags(j),
			'  <div class="jb-card-foot">' + this.render_owner(j) + this.render_age(j) +
				(next && !stage.is_closed ? '<button class="jb-next" data-next="' + jb_esc(next.name) + '" title="' +
					jb_esc(__('Hand over to {0}', [next.name])) + '"><i class="ph ph-arrow-right"></i></button>' : '') + '</div>',
			'</div>'
		].join('\n');
	}

	render_tags(j) {
		var tags = [];
		if (j.drawing) {
			var tone = j.drawing.approved ? 'good' : (j.drawing.status === 'Sent for Approval' ? 'warn' : '');
			tags.push(this.tag('file-text', __('Rev {0}', [jb_esc(j.drawing.rev || '-')]) + ' &middot; ' + jb_esc(__(j.drawing.status)), tone,
				__('Drawing {0}', [j.drawing.no])));
		} else if (j.job_drawing_not_required) {
			tags.push(this.tag('file-text', __('No drawing approval'), ''));
		}
		var m = j.materials || {};
		if (m.to_order) tags.push(this.tag('package', __('{0} to order', [m.to_order]), 'warn'));
		else if (m.on_order) tags.push(this.tag('package', __('{0} on order', [m.on_order]), ''));
		else if (m.total) tags.push(this.tag('package', __('Materials in'), 'good'));
		var q = j.qc || {};
		if (q.total) tags.push(this.tag('check-square', __('QC {0}/{1}', [q.done, q.total]), q.done === q.total ? 'good' : ''));
		if (j.invoice) {
			tags.push(this.tag('receipt', __('Invoice {0}%', [j.to_invoice.percent]), 'good', j.to_invoice.labels.join(', ')));
		}
		return tags.length ? '  <div class="jb-chips">' + tags.join('') + '</div>' : '';
	}

	tag(icon, html, tone, tip) {
		return '<span class="jb-tag' + (tone ? ' jb-t-' + tone : '') + '"' + (tip ? ' title="' + jb_esc(tip) + '"' : '') + '>' +
			'<i class="ph ph-' + icon + '"></i>' + html + '</span>';
	}

	render_owner(j) {
		if (!j.job_owner) {
			return '<span class="jb-avatar jb-none"><i class="ph ph-user"></i></span><span class="jb-owner jb-none">' + __('Unassigned') + '</span>';
		}
		var u = this.data.users[j.job_owner] || {};
		var face = u.image ? '<img src="' + jb_esc(u.image) + '" alt="">' : jb_esc(jb_initials(j.owner_name));
		var state = j.job_work_status === 'In Progress'
			? '<span class="jb-state jb-prog" title="' + __('Working on it now') + '"><i></i>' + __('On it') + '</span>'
			: '<span class="jb-state" title="' + __('Waiting its turn') + '"><i></i>' + __('Queued') + '</span>';
		return '<span class="jb-avatar" style="--jb-av:' + jb_hash_color(j.job_owner) + '" title="' + jb_esc(j.owner_name) + '">' + face + '</span>' +
			'<span class="jb-owner">' + jb_esc(j.owner_name.split(' ')[0]) + '</span>' + (j.closed ? '' : state);
	}

	render_age(j) {
		if (!j.job_stage_since) return '<span class="jb-age"></span>';
		var days = moment(this.data.today).diff(moment(j.job_stage_since).startOf('day'), 'days');
		var text = days <= 0 ? __('today') : __('{0}d', [days]);
		return '<span class="jb-age" title="' + __('Time in this stage') + '"><i class="ph ph-hourglass-medium"></i> ' + text + '</span>';
	}

	// ---- Actions ----------------------------------------------------------

	job(name) {
		return (this.data.jobs || []).filter(function(j) { return j.name === name; })[0];
	}

	open_move(job, to_stage) {
		var me = this;
		var stage = this.data.stage_map[to_stage];
		if (!job || !stage || job.job_stage === to_stage) return;
		var back = stage.index < (this.data.stage_map[job.job_stage] || {}).index;

		var dialog = new frappe.ui.Dialog({
			title: back ? __('Send {0} back to {1}', [job.name, to_stage]) : __('Hand {0} over to {1}', [job.name, to_stage]),
			fields: [
				{
					fieldname: 'owner', fieldtype: 'Link', options: 'User', label: __('Who takes it?'),
					default: stage.default_owner || '',
					get_query: function() { return { query: 'nest_projects.api.stage_users', filters: { stage: to_stage } }; }
				},
				{
					fieldname: 'note', fieldtype: 'Small Text', label: __('Note for them (optional)'),
					description: back ? __('Say what needs fixing.') : ''
				}
			],
			primary_action_label: back ? __('Send Back') : __('Hand Over'),
			primary_action: function(values) {
				dialog.hide();
				me.move(job, to_stage, values.owner, values.note);
			}
		});
		dialog.show();
	}

	move(job, to_stage, owner, note) {
		var me = this;
		frappe.call({
			method: 'nest_projects.api.move_job',
			args: { project: job.name, to_stage: to_stage, owner: owner || null, note: note || null },
			freeze: true,
			callback: function() {
				frappe.show_alert({ message: __('{0} is now in {1}', [job.name, to_stage]), indicator: 'green' });
				me.refresh();
			},
			// The server says why (e.g. a gate); put the card back where it was.
			error: function() { me.render(); }
		});
	}

	bind_events() {
		var me = this;
		var $m = this.$main;

		$m.on('click', '[data-filter]', function() {
			me.filter = $(this).attr('data-filter');
			me.render();
		});
		$m.on('input', '#jb-q', frappe.utils.debounce(function() {
			me.query = ($m.find('#jb-q').val() || '').trim().toLowerCase();
			me.render();
		}, 150));
		$m.on('click', '#jb-refresh', function() { me.refresh(); });

		$m.on('click', '[data-goto]', function() {
			var $col = $m.find('.jb-col[data-col="' + $(this).attr('data-goto') + '"]');
			var board = $m.find('#jb-board')[0];
			if ($col.length && board) board.scrollLeft = $col[0].offsetLeft - board.offsetLeft;
		});

		$m.on('click', '.jb-next', function(e) {
			e.stopPropagation();
			me.open_move(me.job($(this).closest('.jb-card').attr('data-name')), $(this).attr('data-next'));
		});
		$m.on('click', '.jb-card', function() {
			frappe.set_route('Form', 'Project', $(this).attr('data-name'));
		});

		// Drag and drop between columns (desktop). Phones use the arrow button.
		$m.on('dragstart', '.jb-card', function(e) {
			me.drag_name = $(this).attr('data-name');
			$(this).addClass('jb-dragging');
			try { e.originalEvent.dataTransfer.setData('text/plain', me.drag_name); } catch (err) { /* IE-only failure */ }
			e.originalEvent.dataTransfer.effectAllowed = 'move';
		});
		$m.on('dragend', '.jb-card', function() {
			$(this).removeClass('jb-dragging');
			$m.find('.jb-drop').removeClass('jb-drop');
		});
		$m.on('dragover', '.jb-col-body', function(e) {
			if (!me.drag_name) return;
			e.preventDefault();
			e.originalEvent.dataTransfer.dropEffect = 'move';
			$(this).addClass('jb-drop');
		});
		$m.on('dragleave', '.jb-col-body', function(e) {
			if (!this.contains(e.originalEvent.relatedTarget)) $(this).removeClass('jb-drop');
		});
		$m.on('drop', '.jb-col-body', function(e) {
			e.preventDefault();
			$(this).removeClass('jb-drop');
			var name = me.drag_name;
			me.drag_name = null;
			if (name) me.open_move(me.job(name), $(this).attr('data-stage'));
		});
	}
}
