/* Content-script entry. Mounts the sidebar once per page. */
import {mount} from './app.js';

if (!document.getElementById('code-tree-extension')) mount();
