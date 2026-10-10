import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from "n8n-workflow";

/**
 * docketry credentials — a self-hosted API base URL plus a scoped key.
 *
 * Keys are minted per workspace (`dok_agt_…` agent keys or `dok_pat_…`
 * personal access tokens); see docs/agents.md in the docketry repo.
 */
export class DocketryApi implements ICredentialType {
	name = "docketryApi";

	displayName = "docketry API";

	documentationUrl =
		"https://github.com/duketopceo/docketry/blob/main/integrations/n8n/README.md";

	properties: INodeProperties[] = [
		{
			displayName: "Base URL",
			name: "baseUrl",
			type: "string",
			required: true,
			default: "http://localhost:4000",
			placeholder: "https://docketry.example.com",
			description:
				"Root URL of your self-hosted docketry API. Trailing slashes are ignored.",
		},
		{
			displayName: "Workspace",
			name: "workspace",
			type: "string",
			required: true,
			default: "",
			placeholder: "acme",
			description:
				"Workspace slug. Every docketry resource is workspace-scoped, so the node resolves it once here.",
		},
		{
			displayName: "API Key",
			name: "apiKey",
			type: "string",
			typeOptions: { password: true },
			required: true,
			default: "",
			description:
				"A dok_agt_* agent key or dok_pat_* personal access token with read/write scopes.",
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: "generic",
		properties: {
			headers: {
				Authorization: "=Bearer {{$credentials.apiKey}}",
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: "={{$credentials.baseUrl}}",
			url: "/v1/whoami",
			method: "GET",
		},
	};
}
