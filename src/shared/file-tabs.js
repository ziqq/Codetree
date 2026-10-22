/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * File-workspace limits shared by the content script and trusted broker.
 */

/** Maximum number of files kept open in one workspace. */
export const maxFileTabs = 32;
/** Maximum number of revision-specific file positions in one workspace. */
export const maxFileTabPositions = 256;
