**Release: {{github.repository}}**

Version: `{{release_tag}}`
{{#if status_label}}
Status: **{{status_label}}**
{{/if}}
{{#if release_name}}
Name: **{{release_name}}**
{{/if}}
Triggered by: {{github.actor}}

{{#if release_url}}
[Open release]({{url release_url}})
{{/if}}
[Open workflow run]({{url github.run_url}})
