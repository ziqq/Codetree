/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 */

/**
 * Public OAuth client IDs from the maintainer's registered applications.
 *
 * Empty IDs disable OAuth sign-in; personal access tokens keep working.
 * Never add a client secret: the extension is a public client.
 *
 * @module background/oauth/config
 */

/** Client IDs by provider; empty when not registered. */
export const oauthConfig = Object.freeze({github: '', gitlab: ''});
