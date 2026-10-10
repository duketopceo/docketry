import { randomBytes } from "node:crypto";
import type {
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from "n8n-workflow";
import { NodeConnectionTypes } from "n8n-workflow";
import { DOCKETRY_EVENTS, normalizeEventSelection } from "../../lib/events";
import { verifyDocketrySignature } from "../../lib/signature";
import {
	extractList,
	str,
	workspaceUrl,
	type DocketryCredentialShape,
} from "../../lib/transport";

interface EndpointRow {
	id: string;
	url: string;
	events: string[];
	enabled: boolean;
}

/**
 * Outbound-webhook trigger: on activation the node registers a
 * `webhook_endpoints` row pointed at n8n's webhook URL with its own signing
 * secret, so every delivery arrives HMAC-signed (X-Docketry-Signature).
 */
export class DocketryTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: "docketry Trigger",
		name: "docketryTrigger",
		icon: "file:docketry.svg",
		group: ["trigger"],
		version: 1,
		description:
			"Starts the workflow when a docketry outbound webhook event fires (issue created, state changed, dispatched, …)",
		defaults: { name: "docketry Trigger" },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: "docketryApi", required: true }],
		webhooks: [
			{
				name: "default",
				httpMethod: "POST",
				responseMode: "onReceived",
				path: "docketry",
			},
		],
		properties: [
			{
				displayName: "Events",
				name: "events",
				type: "multiOptions",
				required: true,
				default: ["*"],
				description:
					"Which docketry actions fire this trigger. Selecting “All events” subscribes the endpoint to `*`.",
				options: [
					{ name: "All Events", value: "*" },
					...DOCKETRY_EVENTS.map((e) => ({ name: e.name, value: e.value })),
				],
			},
		],
	};

	webhookMethods = {
		default: {
			/** Re-register only when this workflow's URL isn't already subscribed. */
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl("default")!;
				const credentials =
					await this.getCredentials<DocketryCredentialShape>("docketryApi");
				const res = await this.helpers.httpRequestWithAuthentication.call(
					this,
					"docketryApi",
					{
						method: "GET",
						url: workspaceUrl(credentials, "/webhook-endpoints"),
						json: true,
					},
				);
				const endpoints = extractList(res, "endpoints") as EndpointRow[];
				const existing = endpoints.find((e) => e.url === webhookUrl);
				if (!existing) return false;
				this.getWorkflowStaticData("node").endpointId = existing.id;
				return true;
			},

			/** Subscribe n8n's webhook URL with a fresh signing secret. */
			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl("default")!;
				const credentials =
					await this.getCredentials<DocketryCredentialShape>("docketryApi");
				const events = normalizeEventSelection(
					this.getNodeParameter("events", ["*"]) as string[],
				);
				// generated per activation — the API echoes it back once at creation
				const secret = `dok_wh_${randomBytes(24).toString("hex")}`;
				const res = (await this.helpers.httpRequestWithAuthentication.call(
					this,
					"docketryApi",
					{
						method: "POST",
						url: workspaceUrl(credentials, "/webhook-endpoints"),
						json: true,
						body: { url: webhookUrl, events, secret },
					},
				)) as { id?: string };
				if (!res.id) return false;
				const staticData = this.getWorkflowStaticData("node");
				staticData.endpointId = res.id;
				staticData.secret = secret;
				return true;
			},

			/** Unsubscribe on deactivate; the durable delivery sweep stops too. */
			async delete(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData("node");
				const endpointId = staticData.endpointId as string | undefined;
				if (!endpointId) return true;
				const credentials =
					await this.getCredentials<DocketryCredentialShape>("docketryApi");
				try {
					await this.helpers.httpRequestWithAuthentication.call(
						this,
						"docketryApi",
						{
							method: "DELETE",
							url: workspaceUrl(
								credentials,
								`/webhook-endpoints/${endpointId}`,
							),
							json: true,
						},
					);
				} catch {
					// already gone — deactivation must not fail on a stale id
				}
				delete staticData.endpointId;
				delete staticData.secret;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const secret = this.getWorkflowStaticData("node").secret as
			| string
			| undefined;
		const headers = this.getHeaderData();
		const signature =
			typeof headers["x-docketry-signature"] === "string"
				? headers["x-docketry-signature"]
				: undefined;
		// The API signs JSON.stringify(payload); re-stringifying the parsed body
		// reproduces the same bytes (insertion order is preserved), and the
		// check fails closed on any mismatch.
		const raw = JSON.stringify(this.getBodyData());
		if (!verifyDocketrySignature(raw, signature, secret)) {
			return {}; // unsigned/forged deliveries die silently — no workflow run
		}
		const body = this.getBodyData() as Record<string, unknown>;
		const action = str(body, "action");
		return {
			workflowData: [
				[
					{
						json: {
							deliveryId: headers["x-docketry-delivery"] ?? str(body, "id"),
							action,
							...body,
						},
					},
				],
			],
		};
	}
}
