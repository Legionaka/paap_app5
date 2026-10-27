export function createCommunity(getLocationId) {
  const WEATHER_TIME_ZONE = 'Africa/Johannesburg';
  const forumPosts = document.querySelector('#forumPosts');
  const forumAccount = document.querySelector('#forumAccount');
  const forumNotices = document.querySelector('#forumNotices');
  const postDialog = document.querySelector('#postDialog');
  const reportDialog = document.querySelector('#reportDialog');
  let forumUser = null;

  async function communityRequest(path, options = {}) {
    const response = await fetch(`/api/community/${path}`, {
      credentials: 'same-origin',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers ?? {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Community service is unavailable.');
    return data;
  }

  function setForumNotice(message, isError = false) {
    forumNotices.textContent = message;
    forumNotices.classList.toggle('error', isError);
  }

  function formatCommunityDate(date) {
    return new Intl.DateTimeFormat('en-ZA', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: WEATHER_TIME_ZONE,
    }).format(new Date(date));
  }

  function addButton(parent, text, className, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.className = className;
    button.addEventListener('click', onClick);
    parent.append(button);
    return button;
  }

  function reportContent(targetType, targetId) {
    if (!forumUser) {
      setForumNotice('Sign in to report content.', true);
      location.assign(
        `/sign-in/?returnTo=${encodeURIComponent(location.pathname + location.search + '#community')}`,
      );
      return;
    }
    if (!forumUser.emailVerified) {
      setForumNotice('Verify your email before reporting content. Visit your account page.', true);
      return;
    }
    const form = document.querySelector('#reportForm');
    form.elements.targetType.value = targetType;
    form.elements.targetId.value = targetId;
    document.querySelector('#reportError').textContent = '';
    reportDialog.showModal();
  }

  function renderReplies(container, replies, post) {
    for (const reply of replies) {
      const card = document.createElement('article');
      card.className = 'forum-reply';
      const header = document.createElement('div');
      header.className = 'forum-post-meta';
      const author = document.createElement('strong');
      author.textContent = reply.displayName;
      const date = document.createElement('time');
      date.dateTime = reply.createdAt;
      date.textContent = formatCommunityDate(reply.createdAt);
      header.append(author, date);
      const body = document.createElement('p');
      body.textContent = reply.body;
      card.append(header, body);
      if (forumUser?.emailVerified)
        addButton(card, 'Report', 'text-action', () => reportContent('reply', reply.id));
      container.append(card);
    }
    if (forumUser?.emailVerified && !post.isLocked) {
      const form = document.createElement('form');
      form.className = 'reply-form';
      const field = document.createElement('input');
      field.name = 'body';
      field.required = true;
      field.minLength = 2;
      field.maxLength = 3000;
      field.placeholder = 'Write a helpful reply…';
      field.setAttribute('aria-label', 'Write a reply');
      const submit = document.createElement('button');
      submit.type = 'submit';
      submit.textContent = 'Reply';
      form.append(field, submit);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        submit.disabled = true;
        try {
          await communityRequest(`posts/${post.id}/replies`, {
            method: 'POST',
            body: JSON.stringify({ body: field.value }),
          });
          await loadCommunity();
          setForumNotice('Reply posted.');
        } catch (error) {
          setForumNotice(error.message, true);
          submit.disabled = false;
        }
      });
      container.append(form);
    }
  }

  function renderPosts(posts) {
    forumPosts.replaceChildren();
    if (!posts.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-reports forum-empty';
      const title = document.createElement('strong');
      title.textContent = 'Start the first discussion';
      const hint = document.createElement('span');
      hint.textContent =
        'Ask about access, share a trip note, or compare techniques for this water.';
      empty.append(title, hint);
      forumPosts.append(empty);
      return;
    }
    for (const post of posts) {
      const article = document.createElement('article');
      article.className = 'forum-post';
      const meta = document.createElement('div');
      meta.className = 'forum-post-meta';
      const author = document.createElement('strong');
      author.textContent = post.displayName;
      const date = document.createElement('time');
      date.dateTime = post.createdAt;
      date.textContent = formatCommunityDate(post.createdAt);
      meta.append(author, date);
      if (post.isLocked) {
        const locked = document.createElement('span');
        locked.className = 'forum-locked';
        locked.textContent = 'Locked';
        meta.append(locked);
      }
      const title = document.createElement('h3');
      title.textContent = post.title;
      const content = document.createElement('p');
      content.className = 'forum-post-body';
      content.textContent = post.body;
      const actions = document.createElement('div');
      actions.className = 'forum-post-actions';
      const replyCount = document.createElement('span');
      replyCount.textContent = `${post.replyCount} ${post.replyCount === 1 ? 'reply' : 'replies'}`;
      actions.append(replyCount);
      if (forumUser?.emailVerified)
        addButton(actions, 'Report', 'text-action', () => reportContent('post', post.id));
      article.append(meta, title, content, actions);
      const replies = document.createElement('div');
      replies.className = 'forum-replies';
      renderReplies(replies, post.replies, post);
      article.append(replies);
      forumPosts.append(article);
    }
  }

  function renderForumAccount(user) {
    forumAccount.replaceChildren();
    forumAccount.hidden = !user;
    document.querySelector('#forumSignIn').hidden = Boolean(user);
    document.querySelector('#newDiscussion').disabled = false;
    if (!user) return;
    const signed = document.createElement('span');
    signed.textContent = `Signed in as ${user.displayName}`;
    forumAccount.append(signed);
    addButton(forumAccount, 'Sign out', 'text-action', async () => {
      try {
        await communityRequest('auth/logout', { method: 'POST', body: '{}' });
        forumUser = null;
        await loadCommunity();
      } catch (error) {
        setForumNotice(error.message, true);
      }
    });
    if (!user.emailVerified) {
      const verify = document.createElement('a');
      verify.href = '/account/';
      verify.textContent = 'Verify email to post';
      verify.className = 'text-action';
      forumAccount.append(verify);
    }
  }

  async function loadModeration() {
    const panel = document.querySelector('#moderationPanel');
    if (!forumUser || !['moderator', 'admin'].includes(forumUser.role)) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    const list = document.querySelector('#moderationReports');
    try {
      const { reports } = await communityRequest('moderation');
      list.replaceChildren();
      if (!reports.length) {
        const empty = document.createElement('p');
        empty.textContent = 'No open reports.';
        list.append(empty);
        return;
      }
      for (const report of reports) {
        const row = document.createElement('article');
        row.className = 'moderation-report';
        const description = document.createElement('p');
        description.textContent = `${report.reason.replaceAll('_', ' ')} · ${report.reporterName}: ${report.targetPreview || '(content unavailable)'}`;
        row.append(description);
        const actions = document.createElement('div');
        actions.className = 'forum-post-actions';
        const runAction = async (action) => {
          try {
            await communityRequest('moderation', {
              method: 'POST',
              body: JSON.stringify({ reportId: report.id, action }),
            });
            await loadCommunity();
          } catch (error) {
            setForumNotice(error.message, true);
          }
        };
        addButton(actions, 'Hide', 'text-action', () => runAction('hide'));
        if (report.targetType === 'post')
          addButton(actions, 'Restore', 'text-action', () => runAction('restore'));
        if (report.targetType === 'post')
          addButton(actions, report.targetLocked ? 'Unlock' : 'Lock', 'text-action', () =>
            runAction(report.targetLocked ? 'unlock' : 'lock'),
          );
        addButton(actions, 'Dismiss', 'text-action', () => runAction('dismiss'));
        row.append(actions);
        list.append(row);
      }
    } catch (error) {
      list.textContent = error.message;
    }
  }

  async function loadCommunity() {
    if (!getLocationId()) return null;
    try {
      const data = await communityRequest(encodeURIComponent(getLocationId()));
      forumUser = data.user;
      renderForumAccount(forumUser);
      renderPosts(data.posts);
      await loadModeration();
      return forumUser;
    } catch (error) {
      forumPosts.textContent = error.message;
      return null;
    }
  }

  function goToSignIn() {
    location.assign(
      `/sign-in/?returnTo=${encodeURIComponent(location.pathname + location.search + '#community')}`,
    );
  }

  document.querySelector('#forumSignIn').addEventListener('click', goToSignIn);
  document.querySelector('#newDiscussion').addEventListener('click', () => {
    if (!forumUser) {
      goToSignIn();
      return;
    }
    if (!forumUser.emailVerified) {
      setForumNotice(
        'Verify your email from your account page before starting a discussion.',
        true,
      );
      return;
    }
    document.querySelector('#postError').textContent = '';
    postDialog.showModal();
  });
  document
    .querySelectorAll('[data-close-dialog]')
    .forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach((dialog) =>
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    }),
  );

  document.querySelector('#postForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const errorBox = document.querySelector('#postError');
    errorBox.textContent = '';
    try {
      await communityRequest(`${encodeURIComponent(getLocationId())}/posts`, {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      postDialog.close();
      form.reset();
      await loadCommunity();
      setForumNotice('Discussion posted.');
    } catch (error) {
      errorBox.textContent = error.message;
    }
  });

  document.querySelector('#reportForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const errorBox = document.querySelector('#reportError');
    errorBox.textContent = '';
    try {
      await communityRequest('reports', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      reportDialog.close();
      form.reset();
      setForumNotice('Report sent to the moderation queue.');
    } catch (error) {
      errorBox.textContent = error.message;
    }
  });

  return {
    request: communityRequest,
    load: loadCommunity,
    setNotice: setForumNotice,
    get user() {
      return forumUser;
    },
  };
}
