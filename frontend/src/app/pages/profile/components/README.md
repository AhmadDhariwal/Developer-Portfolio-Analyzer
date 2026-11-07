# Profile presentation components

The parent owns API calls, the editable profile draft, shared avatar preview, request state,
cache invalidation and account/photo dialogs. Standalone attribute components use the existing
host elements and classes to preserve the layout. They receive explicit typed inputs and emit
action intent; none creates a second API/state authority. Form inputs edit the passed draft.

- profile-page-header: page navigation and refresh intent.
- profile-avatar-uploader: selection, preview and discard intent; upload/processing state.
- profile-account-telemetry: read-only account metrics.
- profile-personal-information: identity and contact draft fields.
- profile-connected-accounts: GitHub/social fields and existing owned résumé context/link.
- profile-career-preferences: career draft controls and independent save intent.
- profile-notification-settings: notification draft toggles.
- profile-appearance-settings: existing theme preference service controls.
- profile-visibility-settings: consent state and independent visibility intent.
- profile-security-settings: password form and account-deletion dialog intent.

Account deletion and photo dialogs stay in the parent to retain their existing focus/dialog
ownership. Personal fields and notification drafts retain the existing shared Save Changes
action; Career, avatar processing, visibility, password and deletion expose distinct busy states.
The retired full-page save overlay and route binding are removed. Navigation clears local
unsaved photo previews and unsubscribes from view-owned saves. Aborting a client request cannot
undo a commit the server has already accepted; no in-flight discard promises such a rollback.
