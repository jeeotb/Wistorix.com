// ================================================================
// WISTORIX — Invite / Cleanup Shared Logic
// ================================================================

function showToast(msg, isError) {
  const old = document.querySelector('.toast-msg');
  if (old) old.remove();
  const el = document.createElement('div');
  el.className = 'toast-msg';
  if (isError) el.classList.add('error');
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.classList.add('show');
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, 2000);
  });
}

function renderHero(section, isCleanup, credits) {
  if (isCleanup) {
    const isLoadingCredits = !credits;
    const unlimited = credits?.cleanupMode !== 'limited';
    const used = credits ? credits.usedFiles : 0;
    const total = credits ? credits.totalFiles : 0;
    section.innerHTML = `
      <div class="invite-hero">
        <div class="hero-badge">🧹 Quản lý lượt dọn dẹp</div>
        <h2>Theo dõi lượt dọn dẹp <span>Drive của bạn</span></h2>
        <p class="hero-desc">${isLoadingCredits ? 'Đang tải thông tin dọn dẹp...' : unlimited ? 'Gói của bạn có dọn dẹp không giới hạn tệp.' : `Bạn đã dùng ${used}/${total} tệp dọn dẹp.`}</p>
        <div class="hero-link">
          <input value="" readonly placeholder="Đang tải link giới thiệu..." />
          <button id="copyReferralBtn">Sao chép link</button>
        </div>
      </div>
    `;
  } else {
    section.innerHTML = `
      <div class="invite-hero">
        <div class="hero-badge">🎁 Chương trình giới thiệu</div>
        <h2>Mời 1 người — Nhận <span>1 lượt dọn dẹp miễn phí</span></h2>
        <p class="hero-desc">Chia sẻ link giới thiệu của bạn. Khi bạn bè cài đặt Wistorix và quét Drive lần đầu, cả hai cùng nhận 1 lượt dọn dẹp miễn phí!</p>
        <div class="hero-link">
          <input value="" readonly placeholder="Đang tải link giới thiệu..." />
          <button id="copyReferralBtn">Sao chép link</button>
        </div>
        <div class="hero-social">
          <button id="shareFacebookBtn" data-share-channel="facebook" title="Facebook" aria-label="Chia sẻ qua Facebook"><i class="fab fa-facebook-f"></i></button>
          <button id="shareMessengerBtn" data-share-channel="messenger" title="Zalo" aria-label="Chia sẻ qua Messenger"><i class="fas fa-comment-dots"></i></button>
          <button id="shareEmailBtn" data-share-channel="email" title="Email" aria-label="Chia sẻ qua Email"><i class="fas fa-envelope"></i></button>
          <button id="shareLinkBtn" data-share-channel="copy" title="Sao chép" aria-label="Sao chép link"><i class="fas fa-link"></i></button>
        </div>
      </div>
    `;
  }
}

function updateCleanupHero(section, credits) {
  const description = section?.querySelector('.hero-desc');
  if (!description) return;
  description.textContent = credits.cleanupMode !== 'limited'
    ? 'Gói của bạn có dọn dẹp không giới hạn tệp.'
    : `Bạn đã dùng ${credits.usedFiles}/${credits.totalFiles} tệp dọn dẹp.`;
}

function renderStats(section, data) {
  section.innerHTML = data.map(s => `
    <div class="stat-card">
      <div class="stat-icon">${s.icon}</div>
      <div class="stat-title">${s.title}</div>
      <div class="stat-value">${s.value}</div>
      ${s.sub ? `<div class="stat-sub">${s.sub}</div>` : ''}
    </div>
  `).join('');
}

export function cleanupStatsCards(credits) {
  const unlimited = credits.cleanupMode !== 'limited';
  const displayRemaining = unlimited ? 'Không giới hạn' : credits.remainingFiles + ' tệp';
  const displayTotal = unlimited ? 'Không giới hạn' : credits.totalFiles + ' tệp';
  return [
    { icon: '📊', title: 'Đã dùng', value: credits.usedFiles + ' tệp', sub: null },
    { icon: '⚡', title: 'Còn lại', value: displayRemaining, sub: null },
    { icon: '📦', title: 'Tổng lượt', value: displayTotal, sub: null },
  ];
}

function renderProgress(section, p) {
  if (p.unlimited) {
    section.innerHTML = `<div class="progress-card"><div class="progress-header"><span>Dọn dẹp tệp</span><span>Không giới hạn</span></div><div class="progress-legend"><span class="dot-remaining">Dọn dẹp tệp: Không giới hạn</span></div></div>`;
    return;
  }
  const pct = p.total > 0 ? (p.used / p.total) * 100 : 0;
  section.innerHTML = `
    <div class="progress-card">
      <div class="progress-header">
        <span>Tệp dọn dẹp Standard</span>
        <span>${p.total - p.used} còn lại / ${p.total} tổng</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${pct}%"></div>
      </div>
      <div class="progress-legend">
        <span class="dot-used">Đã dùng: ${p.used} tệp</span>
        <span class="dot-remaining">Còn lại: ${p.total - p.used} tệp</span>
      </div>
    </div>
  `;
}

function renderSteps(section, steps) {
  section.innerHTML = steps.map(s => `
    <div class="step-card">
      <div class="step-number">${s.num}</div>
      <h4>${s.title}</h4>
      <p>${s.desc}</p>
    </div>
  `).join('');
}

function renderPeople(section, people) {
  const statusMap = { success: 'Đã tham gia', pending: 'Chưa chấp nhận' };
  section.innerHTML = people.map(p => `
    <div class="invite-item">
      <div class="avatar">${p.initials}</div>
      <div class="info">
        <div class="name">${p.name}</div>
        <div class="time">${p.time}</div>
      </div>
      <div class="reward">${p.reward}</div>
      <div class="status ${p.status}">${statusMap[p.status]}</div>
    </div>
  `).join('');
}

// Page detection
const _mountedPages = {};
const _scope = (root) => ({
  get: (id) => (root || document).querySelector('#' + id),
});

export async function mount(root, pageName) {
  const page = pageName || document.body.dataset.page || 'invite';
  if (_mountedPages[page]) return;
  _mountedPages[page] = true;
  const scope = _scope(root);

if (page === 'invite') {
  const heroEl = scope.get('invite-hero');
  const statsEl = scope.get('invite-stats');
  const progressEl = scope.get('invite-progress');
  const stepsEl = scope.get('invite-steps');
  const listEl = scope.get('invite-people');
  const listHeader = scope.get('invite-people-header');

  if (stepsEl) renderSteps(stepsEl, [
    { num: 1, title: 'Chia sẻ link', desc: 'Gửi link giới thiệu cho bạn bè qua Facebook, Zalo, Email...' },
    { num: 2, title: 'Bạn bè cài đặt & quét', desc: 'Bạn bè cài Wistorix và quét dọn Drive lần đầu tiên' },
    { num: 3, title: 'Bạn nhận lượt', desc: 'Cả hai cùng nhận 1 lượt dọn dẹp miễn phí ngay lập tức' },
  ]);

  // Hero has a built-in loading placeholder for its referral link. Render it
  // before slow credit/referral requests so fragment visibility is not tied to
  // backend latency.
  if (heroEl) renderHero(heroEl, false);

  Promise.all([
    import('./modules/invite-data.js'),
    import('./modules/actions.js'),
    import('./modules/referral.js'),
  ]).then(async ([{ getInvites, getReferralLink, computeInviteStats, formatInviteList }, { computeCredits }, referral]) => {
      const creditsPromise = computeCredits();
      const invitesPromise = getInvites();

      // Invite history does not depend on cleanup-credit backend latency.
      invitesPromise.then(invites => {
        if (listHeader) listHeader.innerHTML = 'Danh sách đã mời <span class="badge">' + invites.length + ' người</span>';
        if (listEl) renderPeople(listEl, formatInviteList(invites));
      }).catch(() => {});

      // Progress is credit-only; do not wait for referral-summary response.
      creditsPromise.then(credits => {
        if (progressEl) {
          renderProgress(progressEl, {
            used: credits.usedFiles,
            total: credits.totalFiles,
            unlimited: credits.cleanupMode !== 'limited'
          });
        }
      }).catch(() => {});

      if (heroEl) {
        const copyBtn = scope.get('copyReferralBtn');
        if (copyBtn) {
          copyBtn.addEventListener('click', async () => {
            const ok = await referral.handleShareCopy(showToast);
            if (ok) {
              copyBtn.textContent = 'Đã sao chép!';
              copyBtn.classList.add('copied');
              setTimeout(() => {
                copyBtn.textContent = 'Sao chép link';
                copyBtn.classList.remove('copied');
              }, 2000);
            }
          });
        }
        const shareHandlers = {
          facebook: referral.handleShareFacebook,
          messenger: referral.handleShareMessenger,
          email: referral.handleShareEmail,
          copy: referral.handleShareCopy,
        };
        heroEl.querySelectorAll('.hero-social button').forEach(btn => {
          const channel = btn.dataset.shareChannel;
          const handler = shareHandlers[channel];
          if (!handler) return;
          btn.addEventListener('click', () => handler(showToast));
        });

        getReferralLink().then(link => {
          const input = heroEl.querySelector('.hero-link input');
          if (input) {
            input.value = link;
            input.placeholder = '';
          }
        }).catch(() => {
          const input = heroEl.querySelector('.hero-link input');
          if (input) input.placeholder = 'Referral landing chưa được cấu hình';
        });
      }

      const [credits, invites] = await Promise.all([creditsPromise, invitesPromise]);
      const inviteStats = await computeInviteStats(credits.usedFiles, invites);

      if (statsEl) {
        renderStats(statsEl, [
          { icon: '👥', title: 'Đã mời thành công', value: inviteStats.successful + ' người', sub: inviteStats.pending > 0 ? (inviteStats.pending + ' lời mời khác đang chờ xử lý') : null },
          { icon: '🎁', title: 'Lượt dọn dẹp đã nhận', value: inviteStats.receivedCredits + ' lượt', sub: null },
          { icon: '⚡', title: 'Lượt dọn dẹp còn lại', value: inviteStats.referralRemaining + ' lượt', sub: null },
        ]);
      }

  }).catch(error => console.error('[invite] load', error));
}

if (page === 'cleanup') {
  const heroEl = scope.get('invite-hero');
  const statsEl = scope.get('invite-stats');
  const progressEl = scope.get('invite-progress');
  const stepsEl = scope.get('invite-steps');
  const listEl = scope.get('invite-people');
  const listHeader = scope.get('invite-people-header');

  if (stepsEl) renderSteps(stepsEl, [
    { num: 1, title: 'Chọn file cần dọn', desc: 'Wistorix phân tích Drive và đề xuất file trùng, file rác cần xoá' },
    { num: 2, title: 'Xác nhận dọn dẹp', desc: 'Xem lại danh sách file và xác nhận dọn dẹp một lần chạm' },
    { num: 3, title: 'Giải phóng dung lượng', desc: 'Hàng GB được giải phóng, Drive của bạn gọn gàng hơn' },
  ]);

  // Shell must not wait for credit/referral backend work. Avoid fabricated
  // credit totals until computeCredits resolves.
  if (heroEl) renderHero(heroEl, true);

  const referralPromise = import('./modules/referral.js');
  referralPromise.then(referral => {
    const input = heroEl?.querySelector('.hero-link input');
    referral.getReferralUrl().then(link => {
      if (input) { input.value = link; input.placeholder = ''; }
    }).catch(() => { if (input) input.placeholder = 'Referral landing chưa được cấu hình'; });
    const linkBtn = scope.get('copyReferralBtn');
    if (linkBtn) linkBtn.addEventListener('click', async () => {
      const ok = await referral.handleShareCopy(showToast);
      if (ok) {
        linkBtn.textContent = 'Đã sao chép!';
        linkBtn.classList.add('copied');
        setTimeout(() => {
          linkBtn.textContent = 'Sao chép link';
          linkBtn.classList.remove('copied');
        }, 2000);
      }
    });
  }).catch(() => {});

  import('./modules/actions.js').then(({ computeCredits, getCleanupSessions, formatBytes: fmtBytes }) => {
    const creditsPromise = computeCredits();
    const sessionsPromise = getCleanupSessions();

    sessionsPromise.then(sessions => {
      if (listHeader) listHeader.innerHTML = 'Lịch sử dọn dẹp <span class="badge">' + sessions.length + ' lượt</span>';
      if (listEl) {
        listEl.innerHTML = sessions.map(s => {
          const date = s.createdAt ? _fmtDate(s.createdAt) : '—';
          const freedText = s.freedBytes > 0 ? fmtBytes(s.freedBytes) + ' đã giải phóng' : s.affectedFiles + ' file đã xử lý';
          return '<div class="cleanup-row">' +
            '<div class="cleanup-date">' + date + '</div>' +
            '<div class="cleanup-detail">' +
              '<div class="cleanup-label">' + s.label + '</div>' +
              '<div class="cleanup-sub">' + freedText + '</div>' +
            '</div>' +
            '<div class="cleanup-amount">' + s.affectedFiles + ' tệp</div>' +
          '</div>';
        }).join('');
      }
    }).catch(error => console.error('[cleanup] history', error));

    creditsPromise.then(credits => {
      if (heroEl) updateCleanupHero(heroEl, credits);
      if (statsEl) {
        renderStats(statsEl, cleanupStatsCards(credits));
      }
      if (progressEl) renderProgress(progressEl, { used: credits.usedFiles, total: credits.totalFiles, unlimited: credits.cleanupMode !== 'limited' });
    }).catch(error => console.error('[cleanup] credits', error));

  }).catch(error => console.error('[cleanup] load', error));
}

}

export async function onShow() {}
export async function onHide() {}

// Standalone (mở invite.html/cleanup.html trực tiếp) → tự khởi động
if (typeof window !== 'undefined' && !window.WistorixRouter) {
  document.addEventListener('DOMContentLoaded', () => { mount(); });
}

function _fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return dd + '/' + mm + '/' + yyyy;
}
