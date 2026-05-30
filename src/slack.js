const slackApiBaseUrl = "https://slack.com/api";

export class SlackApiError extends Error {
  constructor(method, response) {
    super(`Slack API ${method} failed: ${response.error || "unknown_error"}`);
    this.method = method;
    this.response = response;
  }
}

export function createSlackClient(botToken, fetchImpl = fetch) {
  async function api(method, body) {
    const response = await fetchImpl(`${slackApiBaseUrl}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (!data.ok) {
      throw new SlackApiError(method, data);
    }
    return data;
  }

  async function formApi(method, body) {
    const response = await fetchImpl(`${slackApiBaseUrl}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8"
      },
      body: new URLSearchParams(Object.entries(body).map(([key, value]) => [key, String(value)]))
    });

    const data = await response.json();
    if (!data.ok) {
      throw new SlackApiError(method, data);
    }
    return data;
  }

  async function postResponseUrl(responseUrl, body) {
    const response = await fetchImpl(responseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`Slack response_url post failed: ${response.status}`);
    }
  }

  async function downloadFile(url) {
    const response = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${botToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`Slack file download failed: ${response.status}`);
    }

    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") || "application/octet-stream"
    };
  }

  async function uploadFileBytes(uploadUrl, bytes, contentType = "application/octet-stream") {
    const response = await fetchImpl(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Type": contentType
      },
      body: bytes
    });

    if (!response.ok) {
      throw new Error(`Slack file byte upload failed: ${response.status}`);
    }
  }

  return {
    api,
    chatDelete: (body) => api("chat.delete", body),
    chatPostMessage: (body) => api("chat.postMessage", body),
    chatUpdate: (body) => api("chat.update", body),
    conversationsReplies: (body) => formApi("conversations.replies", body),
    downloadFile,
    filesCompleteUploadExternal: (body) => api("files.completeUploadExternal", body),
    filesDelete: (body) => formApi("files.delete", body),
    filesGetUploadURLExternal: (body) => formApi("files.getUploadURLExternal", body),
    filesInfo: (body) => formApi("files.info", body),
    postResponseUrl,
    uploadFileBytes,
    viewsOpen: (body) => api("views.open", body),
    viewsPublish: (body) => api("views.publish", body),
    usersInfo: (body) => formApi("users.info", body)
  };
}
