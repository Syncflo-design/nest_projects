// nest_projects — Job Board. Every job (a Project with a stage) on one Kanban
// board; dragging a card to another column is the handover.
// Desk Page: mounts inside page.body (jQuery in v16) per CoWork_Helper gotcha
// 2026-05-10. HTML is built as string arrays joined with "\n" (page-bundle rule).
// Bump BUILD_MARKER with every CSS change (gotcha 2026-08-18).

frappe.pages['job-board'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({ parent: wrapper, title: __('Job Board'), single_column: true });

	var BUILD_MARKER = 'v0.0.5-2026-10-06-job-panel';
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
var JB_VIEW_KEY = 'nest-projects-board-view';

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
		// By Stage or By Person, remembered per browser.
		this.view = 'stage';
		try { if (localStorage.getItem(JB_VIEW_KEY) === 'person') this.view = 'person'; } catch (e) { /* storage blocked */ }

		// v16: page.body is jQuery; create our own container (gotcha 2026-05-10, Variant 2).
		this.$main = $('<div class="jb-root"></div>').appendTo(page.body);
		var $head = page.head ? $(page.head) : $(page.wrapper).find('.page-head');
		if ($head && $head.length) $head.hide();

		this.render_shell();
		this.panel = new JobPanel(this);
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
			'    <div class="jb-views" role="tablist">',
			'      <button class="jb-view" data-view="stage" role="tab"><i class="ph ph-kanban"></i><span>' + __('By Stage') + '</span></button>',
			'      <button class="jb-view" data-view="person" role="tab"><i class="ph ph-users-three"></i><span>' + __('By Person') + '</span></button>',
			'    </div>',
			'    <span class="jb-filter-note" id="jb-filter-note"></span>',
			'    <button class="jb-iconbtn jb-push" id="jb-demo-remove" title="' + __('Remove demo jobs') + '" style="display:none"><i class="ph ph-broom"></i></button>',
			'    <button class="jb-iconbtn" id="jb-refresh" title="' + __('Refresh') + '"><i class="ph ph-arrows-clockwise"></i></button>',
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
		var by_person = this.view === 'person';
		$('#jb-sub', this.$main).html(
			jb_esc(__('{0} jobs across {1} stages.', [active.length, d.stages.length])) + ' ' +
			'<span class="jb-hint-desk">' + (by_person ? __('Drag a card to another person to reassign it.') : __('Drag a card to hand it over.')) + '</span>' +
			'<span class="jb-hint-phone">' + __('Tap the arrow on a card to hand it over.') + '</span>'
		);
		$('.jb-view', this.$main).each(function() {
			$(this).toggleClass('active', $(this).attr('data-view') === me.view);
		});

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

		var $remove = $('#jb-demo-remove', this.$main);
		$remove.toggle(!!(d.can_demo && d.has_demo));
		$('#jb-refresh', this.$main).toggleClass('jb-push', !$remove.is(':visible'));
		if (!d.jobs.length) {
			this.render_welcome();
			return;
		}

		var visible = d.jobs.filter(function(j) { return me.matches(j); });
		if (by_person) {
			this.render_people(visible);
			return;
		}
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

	// Nothing on the board yet: say how jobs get here, and offer the demo to a System Manager.
	render_welcome() {
		$('#jb-stagebar', this.$main).html('');
		$('#jb-board', this.$main).html([
			'<div class="jb-welcome">',
			'  <i class="ph ph-kanban jb-welcome-icon"></i>',
			'  <div class="jb-welcome-title">' + __('No jobs on the board yet') + '</div>',
			'  <div class="jb-welcome-text">' + __('A project appears here as soon as it is given a stage on its Job tab.') + '</div>',
			this.data.can_demo ? [
				'  <button class="btn btn-primary jb-demo-load"><i class="ph ph-sparkle"></i> ' + __('Load demo jobs') + '</button>',
				'  <div class="jb-welcome-note">' + __('Eleven sample engineer-to-order jobs with six people, drawings, materials, QC checks and payment milestones. Remove them again at any time.') + '</div>'
			].join('\n') : '',
			'</div>'
		].join('\n'));
	}

	load_demo() {
		var me = this;
		frappe.call({
			method: 'nest_projects.demo.load_demo',
			freeze: true,
			freeze_message: __('Setting up the demo workshop...'),
			callback: function(r) {
				var m = r.message || {};
				frappe.show_alert({ message: __('{0} demo jobs loaded', [m.jobs || 0]), indicator: 'green' });
				me.refresh();
			}
		});
	}

	remove_demo() {
		var me = this;
		frappe.confirm(__('Remove all demo jobs, demo people and demo customers?'), function() {
			frappe.call({
				method: 'nest_projects.demo.remove_demo',
				freeze: true,
				freeze_message: __('Removing the demo...'),
				callback: function(r) {
					var m = r.message || {};
					frappe.show_alert({ message: __('{0} demo jobs removed', [m.jobs || 0]), indicator: 'green' });
					if (m.kept && m.kept.length) {
						frappe.msgprint(__('Kept because other records use them: {0}', [m.kept.join(', ')]));
					}
					me.refresh();
				}
			});
		});
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

	// person_mode: the card sits in a person's column, so it shows its stage instead of its owner.
	render_card(j, stage, person_mode) {
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
			'<div class="jb-card' + (j.held ? ' jb-held' : '') + '" draggable="true" data-name="' + jb_esc(j.name) + '"' +
				(person_mode ? ' style="--jb-stage:' + stage.hex + '"' : '') + '>',
			'  <div class="jb-card-top"><span class="jb-jobno">' + jb_esc(j.name) + '</span>' +
				(j.priority === 'High' ? '<i class="ph ph-flag jb-prio" title="' + __('High priority') + '"></i>' : '') + due + '</div>',
			'  <div class="jb-card-title">' + jb_esc(title) + '</div>',
			where ? '  <div class="jb-card-cust"><i class="ph ph-buildings"></i>' + where + '</div>' : '',
			j.held ? '  <div class="jb-block"><i class="ph ph-warning-octagon"></i><span>' + jb_esc(j.job_blocker) + '</span></div>' : '',
			this.render_tags(j),
			'  <div class="jb-card-foot">' +
				(person_mode ? this.render_stage_tag(stage) + this.render_state(j) : this.render_owner(j)) + this.render_age(j) +
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
		return this.avatar(j.job_owner) + '<span class="jb-owner">' + jb_esc(j.owner_name.split(' ')[0]) + '</span>' + this.render_state(j);
	}

	avatar(user, big) {
		var u = this.data.users[user] || {};
		var name = u.full_name || user;
		var face = u.image ? '<img src="' + jb_esc(u.image) + '" alt="">' : jb_esc(jb_initials(name));
		return '<span class="jb-avatar' + (big ? ' jb-avatar-lg' : '') + '" style="--jb-av:' + jb_hash_color(user) + '" title="' + jb_esc(name) + '">' + face + '</span>';
	}

	// Tapping it flips On it / Queued.
	render_state(j) {
		if (j.closed || !j.job_owner) return '';
		return j.job_work_status === 'In Progress'
			? '<button class="jb-state jb-prog" data-work="Queued" title="' + __('Working on it now. Tap to put back in the queue.') + '"><i></i>' + __('On it') + '</button>'
			: '<button class="jb-state" data-work="In Progress" title="' + __('Waiting its turn. Tap when work starts.') + '"><i></i>' + __('Queued') + '</button>';
	}

	render_stage_tag(stage) {
		return '<span class="jb-stagetag" title="' + jb_esc(__('Stage')) + '"><i></i>' + jb_esc(stage.name) + '</span>';
	}

	// ---- By Person --------------------------------------------------------

	render_people(visible) {
		var d = this.data;
		var me = this;
		var people = {};
		visible.filter(function(j) { return !j.closed; }).forEach(function(j) {
			var key = j.job_owner || '';
			(people[key] = people[key] || []).push(j);
		});
		// With nothing filtered, show the stage regulars even when idle: a free engineer is worth seeing.
		if (this.filter === 'all' && !this.query) {
			d.stages.forEach(function(s) {
				if (s.default_owner && !s.is_closed && !people[s.default_owner]) people[s.default_owner] = [];
			});
		}
		var name_of = function(u) { return ((d.users[u] || {}).full_name || u).toLowerCase(); };
		var keys = Object.keys(people).filter(Boolean).sort(function(a, b) { return name_of(a) < name_of(b) ? -1 : 1; });
		if (people['']) keys.push('');

		$('#jb-stagebar', this.$main).html(keys.map(function(u) {
			var label = u ? (d.users[u] || {}).full_name || u : __('Unassigned');
			return '<span class="jb-chip-stage" data-goto="' + jb_esc(u || '__none') + '" style="--jb-stage:' + (u ? jb_hash_color(u) : '#94a3b8') + '">' +
				'<span class="jb-dot"></span>' + jb_esc(label) + ' <b>' + people[u].length + '</b></span>';
		}).join(''));

		$('#jb-board', this.$main).html(keys.length ? keys.map(function(u) { return me.render_person(u, people[u]); }).join('\n')
			: '<div class="jb-empty">' + __('No jobs match.') + '</div>');
	}

	render_person(user, jobs) {
		var d = this.data;
		var me = this;
		jobs.sort(function(a, b) {
			var pa = a.job_work_status === 'In Progress' ? 0 : 1, pb = b.job_work_status === 'In Progress' ? 0 : 1;
			return pa !== pb ? pa - pb : me.compare(a, b);
		});
		var now = jobs.filter(function(j) { return j.job_work_status === 'In Progress'; });
		var queue = jobs.filter(function(j) { return j.job_work_status !== 'In Progress'; });
		var held = jobs.filter(function(j) { return j.held; }).length;
		var over = jobs.filter(function(j) { return j.over; }).length;
		var card = function(j) { return me.render_card(j, d.stage_map[j.job_stage] || {}, true); };

		var name = user ? (d.users[user] || {}).full_name || user : __('Unassigned');
		var face = user ? this.avatar(user, true) : '<span class="jb-avatar jb-avatar-lg jb-none"><i class="ph ph-user"></i></span>';
		var meta = [jobs.length === 1 ? __('1 job') : __('{0} jobs', [jobs.length])];
		if (held) meta.push('<span class="jb-m-bad">' + __('{0} held up', [held]) + '</span>');
		if (over) meta.push('<span class="jb-m-bad">' + __('{0} overdue', [over]) + '</span>');

		var body = '';
		if (now.length) body += '<div class="jb-section">' + __('On it now') + '</div>' + now.map(card).join('\n');
		body += '<div class="jb-section">' + (user ? __('Next up') : __('Waiting for someone')) + ' <b>' + queue.length + '</b></div>';
		body += queue.length ? queue.map(card).join('\n') : '<div class="jb-empty">' + (user ? __('Nothing queued') : __('Nothing waiting')) + '</div>';

		return [
			'<div class="jb-col jb-person" data-col="' + jb_esc(user || '__none') + '" style="--jb-stage:' + (user ? jb_hash_color(user) : '#94a3b8') + '">',
			'  <div class="jb-col-head">' + face + '<div class="jb-person-id"><div class="jb-col-name">' + jb_esc(name) + '</div>' +
				'<div class="jb-col-meta">' + meta.join(' &middot; ') + '</div></div></div>',
			'  <div class="jb-col-body" data-person="' + jb_esc(user) + '">' + body + '</div>',
			'</div>'
		].join('\n');
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
				me.panel.reload_if(job.name);
			},
			// The server says why (e.g. a gate); put the card back where it was.
			error: function() { me.render(); }
		});
	}

	assign(job, owner) {
		var me = this;
		if (!job || (job.job_owner || '') === (owner || '')) return;
		var who = owner ? (this.data.users[owner] || {}).full_name || owner : __('nobody');
		frappe.call({
			method: 'nest_projects.api.assign_job',
			args: { project: job.name, owner: owner || null },
			freeze: true,
			callback: function() {
				frappe.show_alert({ message: __('{0} is now with {1}', [job.name, who]), indicator: 'green' });
				me.refresh();
				me.panel.reload_if(job.name);
			},
			error: function() { me.render(); }
		});
	}

	set_work(job, status) {
		var me = this;
		if (!job) return;
		frappe.call({
			method: 'nest_projects.api.set_work_status',
			args: { project: job.name, status: status },
			callback: function() { me.refresh(); }
		});
	}

	bind_events() {
		var me = this;
		var $m = this.$main;

		$m.on('click', '[data-view]', function() {
			me.view = $(this).attr('data-view');
			try { localStorage.setItem(JB_VIEW_KEY, me.view); } catch (e) { /* storage blocked */ }
			me.render();
			$m.find('#jb-board').scrollLeft(0);
		});
		$m.on('click', '.jb-state[data-work]', function(e) {
			e.stopPropagation();
			me.set_work(me.job($(this).closest('.jb-card').attr('data-name')), $(this).attr('data-work'));
		});

		$m.on('click', '[data-filter]', function() {
			me.filter = $(this).attr('data-filter');
			me.render();
		});
		$m.on('input', '#jb-q', frappe.utils.debounce(function() {
			me.query = ($m.find('#jb-q').val() || '').trim().toLowerCase();
			me.render();
		}, 150));
		$m.on('click', '#jb-refresh', function() { me.refresh(); });
		$m.on('click', '.jb-demo-load', function() { me.load_demo(); });
		$m.on('click', '#jb-demo-remove', function() { me.remove_demo(); });

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
			me.panel.open($(this).attr('data-name'));
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
			if (!name) return;
			// A person's column reassigns; a stage column hands over.
			if ($(this).is('[data-person]')) me.assign(me.job(name), $(this).attr('data-person'));
			else me.open_move(me.job(name), $(this).attr('data-stage'));
		});
	}
}

// ---------------------------------------------------------------------------
// Job panel: tapping a card opens the whole job beside the board, with one-tap
// actions (held up, drawing approval, materials, QC, invoiced, hand over).
// Panel markup uses data-p-* attributes so the board's own handlers ignore it.

var JB_MATERIAL_NEXT = { 'To Order': 'Ordered', 'Ordered': 'Received', 'Received': 'To Order', 'In Stock': 'To Order' };
var JB_MATERIAL_TONE = { 'To Order': 'warn', 'Ordered': '', 'Received': 'good', 'In Stock': 'good' };
var JB_DRAWING_TONE = { 'Draft': '', 'Sent for Approval': 'warn', 'Approved': 'good', 'Superseded': 'bad' };

function jb_next_rev(rev) {
	rev = String(rev || '').trim();
	if (/^\d+$/.test(rev)) return String(parseInt(rev, 10) + 1);
	if (/^[A-Ya-y]$/.test(rev)) return String.fromCharCode(rev.charCodeAt(0) + 1);
	return rev ? rev + '1' : 'A';
}

function jb_when(dt) {
	if (!dt) return '';
	return moment(dt).format(String(dt).length > 10 ? 'D MMM, HH:mm' : 'D MMM YYYY');
}

function jb_tag(html, tone) {
	return '<span class="jb-tag' + (tone ? ' jb-t-' + tone : '') + '">' + html + '</span>';
}

class JobPanel {

	constructor(board) {
		this.board = board;
		this.name = null;
		this.job = null;
		this.editing_blocker = false;
		this.$el = $([
			'<div class="jb-panel-wrap">',
			'  <div class="jb-panel-backdrop"></div>',
			'  <aside class="jb-panel" role="dialog" aria-modal="true"></aside>',
			'</div>'
		].join('\n')).appendTo(board.$main);
		this.$panel = this.$el.find('.jb-panel');
		this.bind();
	}

	open(name) {
		this.name = name;
		this.job = null;
		this.editing_blocker = false;
		this.$panel.removeAttr('style').html('<div class="jb-p-loading"><i class="ph ph-kanban"></i>' + __('Opening {0}...', [jb_esc(name)]) + '</div>');
		this.$el.addClass('open');
		this.load();
	}

	close() {
		this.name = null;
		this.$el.removeClass('open');
	}

	reload_if(name) {
		if (this.name && this.name === name) this.load();
	}

	load() {
		var me = this;
		var name = this.name;
		frappe.call({ method: 'nest_projects.panel.get_job', args: { project: name } }).then(function(r) {
			if (me.name === name && r.message) me.show(r.message);
		});
	}

	// Runs a panel action; the server answers with the refreshed job.
	act(method, args) {
		var me = this;
		var name = this.name;
		frappe.call({
			method: 'nest_projects.panel.' + method,
			args: Object.assign({ project: name }, args || {}),
			callback: function(r) {
				if (me.name === name && r.message) me.show(r.message);
				me.board.refresh();
			}
		});
	}

	show(job) {
		this.job = job;
		this.render();
	}

	user_name(user) {
		return user ? ((this.job.users[user] || {}).full_name || user) : '';
	}

	// ---- Rendering --------------------------------------------------------

	render() {
		var j = this.job;
		var board = this.board;
		var stage = (board.data && board.data.stage_map[j.stage]) || { name: j.stage || __('No stage'), hex: '#94a3b8' };
		var where = [j.customer, j.site].filter(Boolean).map(jb_esc).join(' &middot; ');
		var scroll = this.$panel.find('.jb-p-body').scrollTop() || 0;

		this.$panel.attr('style', '--jb-stage:' + stage.hex);
		this.$panel.html([
			'<header class="jb-p-head">',
			'  <div class="jb-p-top"><span class="jb-jobno">' + jb_esc(j.name) + '</span>' +
				(j.priority === 'High' ? '<i class="ph ph-flag jb-prio" title="' + __('High priority') + '"></i>' : '') +
				board.render_stage_tag(stage) + '<span class="jb-p-gap"></span>' +
				'<a class="jb-p-icon" href="/app/project/' + encodeURIComponent(j.name) + '" title="' + __('Open the full record') + '"><i class="ph ph-arrow-square-out"></i></a>' +
				'<button class="jb-p-icon" data-p-action="close" title="' + __('Close') + '"><i class="ph ph-x"></i></button></div>',
			'  <div class="jb-p-title">' + jb_esc(j.project_name || j.name) + '</div>',
			where ? '  <div class="jb-card-cust"><i class="ph ph-buildings"></i>' + where + '</div>' : '',
			'</header>',
			'<div class="jb-p-body">',
			this.render_facts(),
			this.render_blocker(),
			this.render_drawings(),
			this.render_materials(),
			this.render_checks(),
			this.render_milestones(),
			this.render_history(),
			'</div>',
			this.render_footer(stage)
		].join('\n'));
		this.$panel.find('.jb-p-body').scrollTop(scroll);
	}

	render_facts() {
		var j = this.job;
		var due = '<span class="jb-p-muted">' + __('Not set') + '</span>';
		if (j.due) {
			var days = moment(j.due).diff(moment(this.board.data.today), 'days');
			var cls = days < 0 ? 'jb-over' : (days <= JB_SOON_DAYS ? 'jb-soon' : '');
			var rel = days < 0 ? __('{0} days overdue', [-days]) : (days === 0 ? __('today') : __('in {0} days', [days]));
			due = '<span class="jb-due ' + cls + '">' + jb_esc(moment(j.due).format('D MMM YYYY')) + '</span> <span class="jb-p-muted">' + rel + '</span>';
		}
		var owner = j.owner
			? this.board.avatar(j.owner) + '<span class="jb-owner">' + jb_esc(this.user_name(j.owner)) + '</span>' + this.render_state()
			: '<span class="jb-avatar jb-none"><i class="ph ph-user"></i></span><span class="jb-owner jb-none">' + __('Unassigned') + '</span>';
		if (j.can_write) owner += '<button class="jb-p-link" data-p-action="reassign">' + __('Change') + '</button>';

		var fact = function(label, value, wide) {
			return '<div class="jb-p-fact' + (wide ? ' jb-p-wide' : '') + '"><div class="jb-p-label">' + label + '</div><div class="jb-p-value">' + value + '</div></div>';
		};
		return [
			'<div class="jb-p-facts">',
			fact(__('Responsible'), '<span class="jb-p-owner">' + owner + '</span>', true),
			fact(__('Due'), due),
			fact(__('Priority'), jb_esc(__(j.priority || 'Medium'))),
			fact(__('Quote'), jb_esc(j.quote || '-')),
			fact(__('Customer PO'), jb_esc(j.po || '-')),
			j.scope ? fact(__('Scope'), '<span class="jb-p-scope">' + jb_esc(j.scope) + '</span>', true) : '',
			'</div>'
		].join('\n');
	}

	render_state() {
		var j = this.job;
		if (!j.can_write) return '';
		return j.work_status === 'In Progress'
			? '<button class="jb-state jb-prog" data-p-work="Queued" title="' + __('Tap to put back in the queue') + '"><i></i>' + __('On it') + '</button>'
			: '<button class="jb-state" data-p-work="In Progress" title="' + __('Tap when work starts') + '"><i></i>' + __('Queued') + '</button>';
	}

	render_blocker() {
		var j = this.job;
		if (this.editing_blocker) {
			return [
				'<div class="jb-p-blockedit">',
				'  <label class="jb-p-label" for="jb-p-blocker">' + __('What is holding this job up?') + '</label>',
				'  <textarea id="jb-p-blocker" rows="2" placeholder="' + __('e.g. Waiting for the client to confirm the material') + '">' + jb_esc(j.blocker || '') + '</textarea>',
				'  <div class="jb-p-row-actions">',
				'    <button class="btn btn-xs btn-default" data-p-action="blocker-cancel">' + __('Cancel') + '</button>',
				'    <button class="btn btn-xs btn-danger" data-p-action="blocker-save">' + __('Mark Held Up') + '</button>',
				'  </div>',
				'</div>'
			].join('\n');
		}
		if (j.blocker) {
			return [
				'<div class="jb-block jb-p-block"><i class="ph ph-warning-octagon"></i><span class="jb-p-grow">' + jb_esc(j.blocker) + '</span>',
				j.can_write ? '<button class="jb-p-link" data-p-action="blocker-edit">' + __('Edit') + '</button>' +
					'<button class="btn btn-xs btn-default" data-p-action="blocker-clear"><i class="ph ph-check"></i> ' + __('Sorted') + '</button>' : '',
				'</div>'
			].join('');
		}
		return j.can_write ? '<button class="jb-p-held" data-p-action="blocker-edit"><i class="ph ph-hand-palm"></i> ' + __('Mark as held up') + '</button>' : '';
	}

	section(icon, title, summary, action, body) {
		return [
			'<section class="jb-p-sec">',
			'  <div class="jb-p-sec-head"><i class="ph ph-' + icon + '"></i><span>' + title + '</span>' +
				(summary ? '<span class="jb-p-sum">' + summary + '</span>' : '') + '<span class="jb-p-gap"></span>' + (action || '') + '</div>',
			body,
			'</section>'
		].join('\n');
	}

	render_drawings() {
		var j = this.job;
		var live = j.drawings.filter(function(d) { return d.status !== 'Superseded'; });
		var approved = live.some(function(d) { return d.status === 'Approved'; });
		var summary = approved ? jb_tag(__('Approved'), 'good')
			: (j.drawing_not_required ? '<span class="jb-p-muted">' + __('No approval needed') + '</span>'
				: (live.length ? jb_tag(__('Not approved yet'), 'warn') : ''));
		var add = j.can_write ? '<button class="jb-p-link" data-p-action="drawing-add"><i class="ph ph-plus"></i> ' + __('New revision') + '</button>' : '';

		var rows = j.drawings.slice().reverse().map(function(d) {
			var actions = '';
			if (j.can_write && d.status === 'Draft') {
				actions = '<button class="btn btn-xs btn-default" data-p-action="drawing-status" data-row="' + jb_esc(d.name) + '" data-status="Sent for Approval">' +
					'<i class="ph ph-paper-plane-tilt"></i> ' + __('Sent to client') + '</button>';
			} else if (j.can_write && d.status === 'Sent for Approval') {
				actions = '<button class="btn btn-xs btn-success" data-p-action="drawing-status" data-row="' + jb_esc(d.name) + '" data-status="Approved">' +
					'<i class="ph ph-seal-check"></i> ' + __('Client approved') + '</button>';
			}
			var file = d.file
				? '<a class="jb-p-file" href="' + jb_esc(d.file) + '" target="_blank" rel="noopener" title="' + __('Open drawing') + '"><i class="ph ph-eye"></i></a>'
				: '<span class="jb-p-file jb-p-nofile"><i class="ph ph-file-text"></i></span>';
			return [
				'<div class="jb-p-item' + (d.status === 'Superseded' ? ' jb-p-old' : '') + '">',
				'  ' + file,
				'  <div class="jb-p-grow"><div class="jb-p-item-title">' + jb_esc(d.drawing_no) + ' <span class="jb-p-rev">' + __('Rev {0}', [jb_esc(d.revision || '-')]) + '</span></div>',
				'    <div class="jb-p-item-sub">' + jb_esc(d.title || '') + (d.approved_on ? ' &middot; ' + __('approved {0}', [jb_esc(jb_when(d.approved_on))]) : '') + '</div></div>',
				'  <div class="jb-p-item-side">' + jb_tag(jb_esc(__(d.status)), JB_DRAWING_TONE[d.status] || '') + actions + '</div>',
				'</div>'
			].join('\n');
		}).join('\n');
		var empty = '<div class="jb-p-empty">' + (j.drawing_not_required ? __('This job needs no customer drawing approval.') : __('No drawings yet.')) + '</div>';
		return this.section('file-text', __('Drawings'), summary, add, rows || empty);
	}

	render_materials() {
		var j = this.job;
		if (!j.materials.length) return '';
		var count = function(s) { return j.materials.filter(function(m) { return m.status === s; }).length; };
		var parts = [];
		if (count('To Order')) parts.push(jb_tag(__('{0} to order', [count('To Order')]), 'warn'));
		if (count('Ordered')) parts.push(jb_tag(__('{0} on order', [count('Ordered')]), ''));
		if (!parts.length) parts.push(jb_tag(__('All in'), 'good'));
		var rows = j.materials.map(function(m) {
			var next = JB_MATERIAL_NEXT[m.status] || 'To Order';
			var chip = jb_tag(jb_esc(__(m.status)), JB_MATERIAL_TONE[m.status] || '');
			if (j.can_write) {
				chip = '<button class="jb-p-chipbtn" data-p-action="material" data-row="' + jb_esc(m.name) + '" data-status="' + jb_esc(next) +
					'" title="' + jb_esc(__('Tap to mark {0}', [__(next)])) + '">' + chip + '</button>';
			}
			return [
				'<div class="jb-p-item">',
				'  <span class="jb-p-qty">' + jb_esc(parseFloat(m.qty || 0)) + '&times;</span>',
				'  <div class="jb-p-grow"><div class="jb-p-item-title">' + jb_esc(m.description || m.item || '') + '</div>' +
					(m.status === 'Ordered' && m.expected_on ? '<div class="jb-p-item-sub">' + __('expected {0}', [jb_esc(jb_when(m.expected_on))]) + '</div>' : '') + '</div>',
				'  <div class="jb-p-item-side">' + chip + '</div>',
				'</div>'
			].join('\n');
		}).join('\n');
		return this.section('package', __('Materials'), parts.join(''), '', rows);
	}

	render_checks() {
		var j = this.job;
		var me = this;
		if (!j.checks.length) return '';
		var done = j.checks.filter(function(c) { return c.done; }).length;
		var pct = Math.round(done * 100 / j.checks.length);
		var summary = jb_tag(done + ' / ' + j.checks.length, done === j.checks.length ? 'good' : '');
		var tagname = j.can_write ? 'button' : 'div';
		var rows = j.checks.map(function(c) {
			var who = c.done ? '<div class="jb-p-item-sub">' + jb_esc(me.user_name(c.done_by)) + ' &middot; ' + jb_esc(jb_when(c.done_on)) + '</div>' : '';
			return [
				'<' + tagname + ' class="jb-p-item jb-p-check' + (c.done ? ' jb-p-done' : '') + '"' +
					(j.can_write ? ' data-p-action="check" data-row="' + jb_esc(c.name) + '" data-done="' + (c.done ? 0 : 1) + '"' : '') + '>',
				'  <i class="ph ' + (c.done ? 'ph-check-circle' : 'ph-circle') + ' jb-p-tick"></i>',
				'  <div class="jb-p-grow"><div class="jb-p-item-title">' + jb_esc(c.check) + '</div>' + who + '</div>',
				'</' + tagname + '>'
			].join('\n');
		}).join('\n');
		var bar = '<div class="jb-p-bar"><span style="width:' + pct + '%"></span></div>';
		return this.section('check-square', __('QC / FAT Checks'), summary, '', bar + rows);
	}

	render_milestones() {
		var j = this.job;
		if (!j.milestones.length) return '';
		var here = j.stage_order[j.stage] || 0;
		var rows = j.milestones.map(function(m) {
			var ready = !m.invoiced && m.due_at_stage && (j.stage_order[m.due_at_stage] || 0) < here;
			var side;
			if (m.invoiced) side = jb_tag('<i class="ph ph-check"></i>' + jb_esc(m.invoice_ref || __('Invoiced')), 'good');
			else if (ready && j.can_write) side = '<button class="btn btn-xs btn-warning" data-p-action="invoiced" data-row="' + jb_esc(m.name) + '"><i class="ph ph-receipt"></i> ' + __('Mark invoiced') + '</button>';
			else if (ready) side = jb_tag(__('Ready to invoice'), 'warn');
			else side = jb_tag(__('Not yet'), '');
			return [
				'<div class="jb-p-item">',
				'  <span class="jb-p-qty">' + jb_esc(m.percent || 0) + '%</span>',
				'  <div class="jb-p-grow"><div class="jb-p-item-title">' + jb_esc(m.label) + '</div>' +
					(m.due_at_stage ? '<div class="jb-p-item-sub">' + __('when the job leaves {0}', [jb_esc(m.due_at_stage)]) + '</div>' : '') + '</div>',
				'  <div class="jb-p-item-side">' + side + '</div>',
				'</div>'
			].join('\n');
		}).join('\n');
		return this.section('receipt', __('Payment Milestones'), '<span class="jb-p-muted">' + __('Invoices are raised in Sage') + '</span>', '', rows);
	}

	render_history() {
		var j = this.job;
		var me = this;
		if (!j.history.length) return '';
		var rows = j.history.map(function(h) {
			var what = h.from_stage === h.to_stage
				? __('Reassigned in {0}', [jb_esc(h.to_stage)])
				: (h.from_stage ? jb_esc(h.from_stage) + ' <i class="ph ph-arrow-right"></i> ' + jb_esc(h.to_stage) : __('Opened in {0}', [jb_esc(h.to_stage)]));
			var who = [];
			if (h.to_owner) who.push(__('to {0}', [jb_esc(me.user_name(h.to_owner))]));
			if (h.moved_by) who.push(__('by {0}', [jb_esc(me.user_name(h.moved_by))]));
			return [
				'<div class="jb-p-event">',
				'  <span class="jb-p-dot"></span>',
				'  <div class="jb-p-grow"><div class="jb-p-item-title">' + what + '</div>',
				'    <div class="jb-p-item-sub">' + who.join(' ') + (who.length ? ' &middot; ' : '') + jb_esc(jb_when(h.moved_on)) + '</div>',
				h.note ? '    <div class="jb-p-note">' + jb_esc(h.note) + '</div>' : '',
				'  </div>',
				'</div>'
			].join('\n');
		}).join('\n');
		return this.section('clock-counter-clockwise', __('History'), '', '', '<div class="jb-p-timeline">' + rows + '</div>');
	}

	render_footer(stage) {
		var j = this.job;
		if (!j.can_write || (!j.next_stage && !j.previous_stage)) return '';
		var gate = j.gate_block
			? '<div class="jb-p-gate"><i class="ph ph-lock-simple"></i><span>' + __("Can't leave {0} yet: {1}", [jb_esc(stage.name), jb_esc(j.gate_block)]) + '</span></div>' : '';
		var back = j.previous_stage
			? '<button class="btn btn-default jb-p-back" data-p-action="move" data-stage="' + jb_esc(j.previous_stage) + '" title="' +
				jb_esc(__('Send back to {0}', [j.previous_stage])) + '"><i class="ph ph-arrow-bend-up-left"></i><span>' + __('Send back') + '</span></button>' : '';
		var next = j.next_stage
			? '<button class="btn btn-primary jb-p-next" data-p-action="move" data-stage="' + jb_esc(j.next_stage) + '"' + (j.gate_block ? ' disabled' : '') + '>' +
				__('Hand over to {0}', [jb_esc(j.next_stage)]) + ' <i class="ph ph-arrow-right"></i></button>' : '';
		return '<footer class="jb-p-foot">' + gate + '<div class="jb-p-foot-row">' + back + next + '</div></footer>';
	}

	// ---- Actions ----------------------------------------------------------

	add_drawing() {
		var me = this;
		var live = this.job.drawings.filter(function(d) { return d.status !== 'Superseded'; });
		var last = live[live.length - 1] || this.job.drawings[this.job.drawings.length - 1] || {};
		var dialog = new frappe.ui.Dialog({
			title: __('New drawing revision for {0}', [this.job.name]),
			fields: [
				{ fieldname: 'drawing_no', fieldtype: 'Data', label: __('Drawing No'), reqd: 1,
				  default: last.drawing_no || ('GA-' + this.job.name.replace(/\D/g, '') + '-01') },
				{ fieldname: 'revision', fieldtype: 'Data', label: __('Revision'), reqd: 1,
				  default: last.revision ? jb_next_rev(last.revision) : 'A' },
				{ fieldname: 'title', fieldtype: 'Data', label: __('Title'), default: last.title || '' },
				{ fieldname: 'file', fieldtype: 'Attach', label: __('Drawing file') }
			],
			primary_action_label: __('Add Revision'),
			primary_action: function(v) {
				dialog.hide();
				me.act('add_drawing', { drawing_no: v.drawing_no, revision: v.revision, title: v.title, file_url: v.file });
			}
		});
		dialog.show();
	}

	reassign() {
		var me = this;
		var stage = this.job.stage;
		var dialog = new frappe.ui.Dialog({
			title: __('Who has {0}?', [this.job.name]),
			fields: [{
				fieldname: 'owner', fieldtype: 'Link', options: 'User', label: __('Responsible'), default: this.job.owner || '',
				get_query: function() { return { query: 'nest_projects.api.stage_users', filters: { stage: stage } }; }
			}],
			primary_action_label: __('Save'),
			primary_action: function(v) {
				dialog.hide();
				me.board.assign({ name: me.job.name, job_owner: me.job.owner }, v.owner || '');
			}
		});
		dialog.show();
	}

	bind() {
		var me = this;
		var $p = this.$panel;

		this.$el.on('click', '.jb-panel-backdrop', function() { me.close(); });
		$(document).on('keydown.jbpanel', function(e) {
			if (e.key === 'Escape' && me.name && !$('.modal:visible').length) me.close();
		});

		$p.on('click', '[data-p-work]', function() {
			frappe.call({
				method: 'nest_projects.api.set_work_status',
				args: { project: me.name, status: $(this).attr('data-p-work') },
				callback: function() { me.load(); me.board.refresh(); }
			});
		});

		$p.on('click', '[data-p-action]', function(e) {
			var $b = $(this);
			var action = $b.attr('data-p-action');
			var row = $b.attr('data-row');
			e.preventDefault();
			if (action === 'close') {
				me.close();
			} else if (action === 'blocker-edit') {
				me.editing_blocker = true;
				me.render();
				$p.find('#jb-p-blocker').trigger('focus');
			} else if (action === 'blocker-cancel') {
				me.editing_blocker = false;
				me.render();
			} else if (action === 'blocker-save') {
				var text = ($p.find('#jb-p-blocker').val() || '').trim();
				if (!text) {
					frappe.show_alert({ message: __('Say what is holding it up.'), indicator: 'orange' });
					return;
				}
				me.editing_blocker = false;
				me.act('set_blocker', { text: text });
			} else if (action === 'blocker-clear') {
				me.act('set_blocker', { text: '' });
			} else if (action === 'drawing-status') {
				me.act('set_drawing_status', { row: row, status: $b.attr('data-status') });
			} else if (action === 'drawing-add') {
				me.add_drawing();
			} else if (action === 'material') {
				me.act('set_material_status', { row: row, status: $b.attr('data-status') });
			} else if (action === 'check') {
				me.act('set_check', { row: row, done: $b.attr('data-done') });
			} else if (action === 'invoiced') {
				frappe.prompt(
					[{ fieldname: 'ref', fieldtype: 'Data', label: __('Sage invoice number'), description: __('Optional. For reference only.') }],
					function(v) { me.act('mark_invoiced', { row: row, invoice_ref: v.ref }); },
					__('Mark as invoiced'), __('Save')
				);
			} else if (action === 'reassign') {
				me.reassign();
			} else if (action === 'move') {
				me.board.open_move({ name: me.job.name, job_stage: me.job.stage }, $b.attr('data-stage'));
			}
		});
	}
}
