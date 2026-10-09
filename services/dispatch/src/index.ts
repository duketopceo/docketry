export interface DispatchAdapter {
  name: string;
  launch(issueKey: string): Promise<{ sessionId: string }>;
}
