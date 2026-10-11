import { randomBytes } from "node:crypto";
import type {
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from "n8n-workflow";
import { NodeConnectionTypes } from "n8n-workflow";
import { TALLYLINE_EVENTS, normalizeEventSelection } from "../../lib/events";
import { deliveryHeader, verifyTallylineSignature } from "../../lib/signature";
import {
	extractList,
	str,
	workspaceUrl,
	type TallylineCredentialShape,
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
 * secret, so every delivery arrives HMAC-signed (X-Tallyline-Signature).
 */
export class TallylineTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: "tallyline Trigger",
		name: "tallylineTrigger",
		icon: "file:tallyline.svg",
		group: ["trigger"],
		version: 1,
		description:
			"Starts the workflow when a tallyline outbound webhook event fires (issue created, state changed, dispatched, …)",
		defaults: { name: "tallyline Trigger" },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: "tallylineApi", required: true }],
		webhooks: [
			{
				name: "default",
				httpMethod: "POST",
				responseMode: "onReceived",
				path: "tallyline",
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
					"Which tallyline actions fire this trigger. Selecting “All events” subscribes the endpoint to `*`.",
				options: [
					{ name: "All Events", value: "*" },
					...TALLYLINE_EVENTS.map((e) => ({ name: e.name, value: e.value })),
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
					await this.getCredentials<TallylineCredentialShape>("tallylineApi");
				const res = await this.helpers.httpRequestWithAuthentication.call(
					this,
					"tallylineApi",
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
					await this.getCredentials<TallylineCredentialShape>("tallylineApi");
				const events = normalizeEventSelection(
					this.getNodeParameter("events", ["*"]) as string[],
				);
				// generated per activation — the API echoes it back once at creation
				const secret = `tly_wh_${randomBytes(24).toString("hex")}`;
				const res = (await this.helpers.httpRequestWithAuthentication.call(
					this,
					"tallylineApi",
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
					await this.getCredentials<TallylineCredentialShape>("tallylineApi");
				try {
					await this.helpers.httpRequestWithAuthentication.call(
						this,
						"tallylineApi",
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
		const signature = deliveryHeader(headers, "x-tallyline-signature");
		// The API signs JSON.stringify(payload); re-stringifying the parsed body
		// reproduces the same bytes (insertion order is preserved), and the
		// check fails closed on any mismatch.
		const raw = JSON.stringify(this.getBodyData());
		if (!verifyTallylineSignature(raw, signature, secret)) {
			return {}; // unsigned/forged deliveries die silently — no workflow run
		}
		const body = this.getBodyData() as Record<string, unknown>;
		const action = str(body, "action");
		return {
			workflowData: [
				[
					{
						json: {
							deliveryId: deliveryHeader(headers, "x-tallyline-delivery") ?? str(body, "id"),
							action,
							...body,
						},
					},
				],
			],
		};
	}
}
