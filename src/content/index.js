/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Content-script entry point.
 *
 * Mounts the sidebar once per page; a second injection of the script
 * (for example, a manifest and a registered script on the same host)
 * finds the existing host element and does nothing.
 */

import {mount} from './app.js';

if (!document.getElementById('codetree-extension')) mount();
