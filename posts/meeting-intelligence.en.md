---
title: "How We Built an Automated Meeting Intelligence System with Google Meet, Slack, and RAG"
publishedAt: "2026-04-11"
updatedAt: "2026-05-16"
slug: "meeting-intelligence"
summary: "AI summaries aren't enough — context dies when a meeting ends. We pipe Google Meet recordings to Slack, transcribe everything, and make history queryable in natural language."
tags:
  - "ai"
  - "gcp"
  - "typescript"
  - "webdev"
lang: "en"
syndication:
  zenn:
    id: "a820ce302ec5e9"
  devto:
    id: 3486118
    slug: "how-we-built-an-automated-meeting-intelligence-system-with-google-meet-slack-and-rag-42ln"
cover: /posts/meeting-intelligence.en.cover.png
---

Hi, I'm [Ryan](https://x.com/ryantsuji), CTO at airCloset — a fashion subscription service based in Japan.

In previous posts, I wrote about building a [DB Graph MCP server](/posts/db-graph-mcp) that lets you query 991 database tables across 15 schemas with natural language, and a [suite of 17 MCP servers](/posts/17-mcp-servers) that opened our internal operations to AI.

This time, it's not about MCP. It's about something more fundamental — **turning meetings into a searchable knowledge base**. This is the system I've wanted to build first when thinking about digitizing our company's information assets.

We built a system that **automatically shares** Google Meet **recordings and transcripts** to Slack channels, and makes past meeting content **searchable with natural language**.

## The Problem: Context Disappears the Moment a Meeting Ends

Face-to-face communication is fast and dense. A decision that takes 30 minutes over text can happen in 5 minutes in a meeting. That's the biggest advantage of meetings.

But the problem is that **context starts disappearing the moment the meeting ends**.

- "What did we decide in that meeting again?"
- "There's a recording but I don't have the energy to rewatch an hour-long video"
- "Where did I write those meeting notes?"
- "We keep having the same discussion over and over"

Building a habit of writing meeting notes is one solution, but honestly, getting everyone to consistently write good notes is hard. Even when they do, the nuance of the conversation is lost.

**Meetings are a treasure trove of information, yet they're not being utilized.** That's a huge waste.

## What We Built

We built a system that automates four things:

1. **One-click Meet creation from Google Calendar** — A Chrome extension creates a Meet with recording, transcription, and notes all enabled by default
2. **Automatic Slack notification when a meeting ends** — Instant notification, followed by recording and transcript links minutes later
3. **Automatic permission granting** — Access is automatically given to Slack channel members, meeting participants, and Calendar invitees
4. **RAG search over transcripts and screen shares** — Ask a Slack Bot "What was the release date we discussed last week?" and get an answer

## User Flow

### Step 1: Create a Meeting (~10 seconds)

In Google Calendar's event editor, click the "AI Fassy Meet" button added by our Chrome extension.

![Chrome extension button in Google Calendar](/images/posts/meeting-intelligence/kymrlq5fa5z5bx41fkbo.png)


*The "AI Fassy Meet" button appears next to Google Meet's native video conferencing option*

Select the Slack channel where notifications should be sent. Previously selected channels appear at the top, followed by your most active channels.

![Slack channel selection dialog](/images/posts/meeting-intelligence/9xsm3lzazvw8pnu87jx0.png)
*Channel search and selection dialog, sorted by selection history and activity*

Click "Create Meet" and the Meet URL is automatically set on the Calendar event.


![Setting Meet URL](/images/posts/meeting-intelligence/dfs0rfdcxgoxfes3or3e.png)
*The Meet URL is set on the event with recording, transcription, and notes all enabled by default. The "Use Gemini to create meeting notes" shown on screen is Google Meet's native feature — our system additionally integrates Gemini 3 Flash for independent transcription and screen share analysis*

**Recording, transcription, and meeting notes are all ON by default.** Users don't need to think about settings at all.

The channel dropdown shows **previously selected channels first**, then **channels you're a member of, sorted by message activity**. For recurring meetings, last week's channel is always one click away.

### Step 2: Hold the Meeting

Just have your meeting normally. Recording and transcription run automatically in the background.

### Step 3: Automatic Notification When the Meeting Ends

When the meeting ends, an instant notification appears in the designated Slack channel.


![Slack meeting ended notification](/images/posts/meeting-intelligence/3jfoejww8nqd1ff0ss3e.png)

A few minutes later, a follow-up notification arrives in the thread with links to the recording and transcript. Channel members can view them immediately.

### Step 4: Search Past Meetings with Natural Language

In the same thread, mention the Bot to ask about the meeting content.


![Full thread flow — end notification → artifact notification → RAG search → answer](/images/posts/meeting-intelligence/s39j5jorq2ka5uggkhe1.png)
*Full thread flow: ①Meeting ended notification → ②Recording and transcript links → ③User asks "Give me a summary of this meeting" → ④Bot responds with a structured summary*

The Bot searches past meeting transcripts, summarizes the relevant parts, and responds with source links. Screen-shared slides and code are also searchable.

---

Now let's dive into the technical implementation.

## Architecture Overview


![System Overview](/images/posts/meeting-intelligence/m244hghef2xv24tgaj2u.png)

The system consists of four components:

| Component | Role | Deployment |
|-----------|------|------------|
| **Chrome Extension + meet-calendar API** | Meet creation UI + backend API | Chrome / Cloud Run |
| **workspace-pipeline** | Workspace Events API subscription management | Shared package |
| **meet-pipeline** | Core event processing: artifact storage, permissions, embedding generation | Cloud Run |
| **Slack Bot** | Meet creation + RAG search | Cloud Run |

Shared domain logic (Space creation, Firestore operations, Drive access, caching) is extracted into a common package, reused by both the Chrome Extension API and the Slack Bot.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Chrome Extension (Manifest V3) |
| API | Cloud Run (Hono) |
| Event Processing | Cloud Pub/Sub → Cloud Run |
| Workspace Integration | Meet REST API, Drive API, Workspace Events API, Calendar API |
| AI/ML | Vertex AI Embeddings (gemini-embedding-001), Gemini 3 Flash |
| Data Stores | Firestore, BigQuery, Cloud Storage, Upstash Redis |
| Notifications | Slack Block Kit API |
| Infrastructure | Pulumi (TypeScript) |

## Deep Dive 1: Pre-Pooling Meet Spaces — LIFO Cache

### Problem: Meet Creation Is Slow

Creating a new Google Meet Space via API takes 1–2 seconds for a response. Making users wait several seconds after clicking a button is an unacceptable UX.

### Solution: Pre-Create and Pool

The idea is simple: **pre-create Meet Spaces via API and return them instantly on request**. Replenish in the background when consumed.


![LIFO Cache](/images/posts/meeting-intelligence/ws3xf9dmh10z7n2fqgu3.png)

```typescript
class MeetSpaceCache {
  private cachePool: CachedMeetSpace[] = [];
  private readonly targetSize = 3;
  private readonly maxSize = 5;
  private readonly ttlMs = 24 * 60 * 60 * 1000; // 24 hours

  getMeetSpaceFromCache(): CachedMeetSpace | undefined {
    // Filter expired entries, then pop the newest
    this.cachePool = this.cachePool.filter(s => !this.isExpired(s));
    const space = this.cachePool.pop(); // LIFO
    if (space) {
      this.emitter.emit('spaceConsumed'); // Trigger background replenishment
    }
    return space;
  }
}
```

**Why LIFO?** By always returning the newest Space, we minimize the risk of serving an expired one. Older Spaces naturally expire and get filtered out on the next `pop()`.

Replenishment is event-driven via `EventEmitter`. When a Space is consumed, `replenish()` runs in the background after a 100ms delay. A mutex (`isReplenishing` flag) prevents concurrent API requests.

```typescript
initializeMeetCache(createSpace) {
  this.emitter.on('spaceConsumed', () => {
    setTimeout(() => this.replenish(createSpace), 100);
  });
  // Build initial pool on startup
  this.replenish(createSpace);
}
```

This brings most requests down to **under 100ms latency** for returning a Meet URL. The cache lives in a shared domain package, reused by both the Chrome Extension API and the Slack Bot.

## Deep Dive 2: Designing for Adoption — Chrome Extension

### We Started with a Slack Command

The first thing we built was a **`/meet` command in Slack**. Mention the bot and it returns a Meet link. Technically, it worked perfectly.

But **nobody used it**.

Why? The meeting creation flow is "create a Calendar event → invite participants → set the Meet URL." The Slack command is **outside** this flow. Switching to Slack, typing a command, copying the URL, pasting it into Calendar — that's too much friction.

### Meet Users Where They Already Are

The insight was that **features must be placed on the user's existing path to get adopted**.

Google Calendar's event editor is a place **everyone passes through** when scheduling a meeting. Put a button there and it's one click. That's why we built a Chrome Extension.

The Slack command still exists and some people use it. But adoption skyrocketed after shipping the Chrome Extension.

### Optimizing Channel Selection

We also put effort into the channel selection UX. The dropdown order is determined by the following logic:

**Tier 1: Personal Selection History (Redis ZSET)**

```typescript
// Store in Redis ZSET with score=timestamp
async saveChannelSelection(userId, channel) {
  // Remove duplicate of same channel
  await redis.zrem(key, existingMember);
  // Add with latest timestamp
  await redis.zadd(key, { score: Date.now(), member: JSON.stringify(channel) });
  // Cap at 50 entries
  await redis.zremrangebyrank(key, 0, -(MAX_RECENT + 1));
}
```

Previously selected channels appear at the top. For recurring meetings, last week's channel is always first. Using Redis ZSET with timestamps as scores gives O(log N) insertion and natural chronological ordering.

**Tier 2: Channel Activity (Firestore `sortPriority`)**

Channels without selection history are sorted by a pre-computed `sortPriority` (based on message volume) in Firestore. Frequently used channels rank higher.

Both sources are fetched in parallel, with Redis results taking priority in the merge, ensuring a useful list even on first load.

## Deep Dive 3: Domain-Wide Delegation — Why a "Proxy Account" Is Needed

### The File Ownership Problem

When you enable recording in Google Meet, the recording and transcript files are created in **the organizer's personal Drive**. This is a Google Workspace behavior that cannot be changed.

This is a major problem.

When files are scattered across different organizers' Drives, **the system cannot uniformly access them**. Copying recordings to GCS, loading transcripts into BQ, granting permissions to channel members — all these automated operations require reliable file access. If the organizer differs each time, you'd have to track which Drive the file is in and manage each person's OAuth tokens. This is operationally untenable.

### Solution: Impersonation via a Shared Service Account

We use Domain-Wide Delegation (DWD) to have a **service account act as a Workspace admin**.

```typescript
const auth = new google.auth.JWT({
  email: serviceAccountEmail,  // Service account
  key: privateKey,
  scopes: [
    'https://www.googleapis.com/auth/meetings.space.created',
    'https://www.googleapis.com/auth/drive',
  ],
  subject: workspaceAdminEmail,  // Act as this admin
});
```

Since APIs execute as the Workspace admin specified in `subject`, both Meet Space creation and Drive file ownership are consolidated under this shared account.

When creating a Space, we set recording and transcription to **ON by default** via `artifactConfig`:

```typescript
body: JSON.stringify({
  config: {
    accessType: 'TRUSTED',
    entryPointAccess: 'ALL',
    artifactConfig: {
      recordingConfig: {
        autoRecordingGeneration: 'ON',  // Recording: ON by default
      },
      transcriptionConfig: {
        autoTranscriptionGeneration: 'ON',  // Transcription: ON by default
      },
    },
  },
}),
```

Users never "forget to turn on recording." Every Meet created through this system is guaranteed to be recorded and transcribed.

**Benefits:**
- Files are always consolidated in the same account's Drive → uniform system access
- No individual OAuth token management needed
- Same credentials work regardless of who organizes the meeting
- One-time setup in Workspace Admin Console, then it just works with the service account key

**Workspace Admin privileges are required** for the initial setup, but it's a one-time task.

### Calendar Search via DWD

When notifying Slack on meeting end, we need the **meeting title**. But the Meet API doesn't provide it — the title only exists on the Calendar side.

DWD helps here too. We first search the organizer's Calendar, then iterate through participants' Calendars.

```typescript
async function searchCalendarEventTitle(meetCode, creatorEmail, participants) {
  // 1. Search the organizer's calendar first
  const creatorEvent = await searchCalendar(creatorEmail, meetCode);
  if (creatorEvent) return creatorEvent.summary;

  // 2. Fall back to participants
  for (const participant of participants) {
    const event = await searchCalendar(participant.email, meetCode);
    if (event) return event.summary;
  }

  // 3. Fall back to Firestore cache
  return meetInfo.calendarTitle ?? null;
}
```

With DWD, you can search any user's Calendar by simply swapping the `subject`. No Calendar sharing settings needed.

## Deep Dive 4: Workspace Events API — Real-Time Event-Driven Architecture

### No Polling

"How do we detect when a Meet ends?" — this was the first challenge.

Polling the API for status checks lacks real-time responsiveness and increases API call volume.

**Google Workspace Events API** lets you receive Meet lifecycle events in real-time via Pub/Sub.

```typescript
const subscription = await workspaceEvents.subscriptions.create({
  requestBody: {
    targetResource: `//meet.googleapis.com/${spaceName}`,
    eventTypes: [
      'google.workspace.meet.conference.v2.ended',        // Meeting ended
      'google.workspace.meet.recording.v2.fileGenerated',  // Recording ready
      'google.workspace.meet.transcript.v2.fileGenerated', // Transcript ready
    ],
    notificationEndpoint: {
      pubsubTopic: `projects/${projectId}/topics/meet-events`,
    },
    payloadOptions: { includeResource: true },
  },
});
```

We create a Subscription when the Meet Space is created, delivering three event types to the `meet-events` Pub/Sub topic.

### Fighting the 7-Day Expiration

However, these Subscriptions have a **7-day maximum TTL** (604,800 seconds). This is a Google API constraint that cannot be changed. Left unattended, subscriptions expire and events stop arriving.

This becomes a problem in cases like:

- **Recurring meetings** — A weekly Monday standup reuses the same Meet Space. The subscription expires before next Monday
- **Future meetings** — Creating a Meet in advance for next week's 1:1. If more than 7 days pass from creation, events won't arrive on the meeting day

In other words, **without automatic subscription renewal, recurring and future meetings won't work**.

### Daily Batch Auto-Renewal

We run a daily batch via Cloud Scheduler at 5:00 AM JST, processing in two phases:

```typescript
async function renewSubscriptions(): Promise<RenewalResult> {
  // Phase 1: Invalidate old Spaces (run before renewal)
  // → Processing invalidations first excludes them from Phase 2
  const spacesToInvalidate = await getMeetSpacesNeedingInvalidation(thirtyDaysAgo);
  for (const space of spacesToInvalidate) {
    await invalidateMeetSpace(space.spaceName);  // isValid = false
  }

  // Phase 2: Renew Subscriptions
  const spacesToRenew = await getMeetSpacesNeedingRenewal(sixDaysAgo);
  for (const space of spacesToRenew) {
    // Create new Subscription (old one auto-expires)
    const newSubscriptionName = await createMeetSubscription(
      space.spaceName, subscriptionConfig,
    );
    await updateMeetSpaceSubscription(space.spaceName, newSubscriptionName);
  }
}
```

**Phase 1: Invalidation** — Spaces where `meetingEndAt` is over 30 days ago are set to `isValid: false`. After 30 days since a meeting ended, no recording or transcript events will arrive. Invalidation excludes them from Phase 2, reducing unnecessary API calls.

**Phase 2: Renewal** — Spaces where `subscribedAt` is 6+ days ago (one day before expiration) get a new Subscription. Old subscriptions auto-expire, so explicit deletion is unnecessary.

### Subscription Lifecycle

```plaintext
Day 0: Meet created → Subscription created (TTL: 7 days)
Day 6: Daily batch → Subscription renewed (new TTL: 7 days)
Day 12: Daily batch → Subscription renewed (new TTL: 7 days)
  ...repeats...
Day 30+: Daily batch → isValid=false → renewal stops
```

With this mechanism, **even if you create a Meet today for a meeting next month, the subscription is auto-renewed daily so events are guaranteed to arrive on the meeting day**. Recurring meetings similarly work across multiple weeks with the same Meet Space.

## Deep Dive 5: Event Processing Pipeline

From meeting end to Slack notification to vector data generation for RAG search — everything starts from receiving a Pub/Sub message.


![Event Pipeline](/images/posts/meeting-intelligence/vxt2h19edh6x4l8alqa0.png)

### Event Router: Dispatching to Three Handlers

```typescript
async function handleMeetEvent(pubsubMessage) {
  const eventType = pubsubMessage.attributes?.['ce-type'];
  const spaceName = normalizeSpaceName(pubsubMessage.attributes?.['ce-subject']);

  // Fetch space info from Firestore
  const meetInfo = await getMeetSpaceInfo(spaceName);

  switch (eventType) {
    case 'google.workspace.meet.conference.v2.ended':
      return handleMeetEnded(meetInfo, pubsubMessage);
    case 'google.workspace.meet.recording.v2.fileGenerated':
      return handleRecordingGenerated(meetInfo, pubsubMessage);
    case 'google.workspace.meet.transcript.v2.fileGenerated':
      return handleTranscriptGenerated(meetInfo, pubsubMessage);
  }
}
```

One caveat: the Pub/Sub event's `targetResource` may contain a `conferenceRecordId` instead of a `spaceName`. Google Meet creates a new conference record for each session in the same Space. In that case, we resolve `conferenceRecordId → spaceName` via the Meet API.

### ① handleMeetEnded — On Meeting End

1. Update Firestore status to `ended`
2. Fetch participant list from Meet API
3. Search Calendar API for the meeting title (DWD to search participants' calendars)
4. Save participant info to BQ (making "who attended" searchable via RAG)
5. Send "meeting ended" notification to Slack
6. Save notification `ts` (timestamp) to Firestore → subsequent notifications thread under it

### ② handleRecordingGenerated — On Recording Completion

The recording handler is the most complex:

```plaintext
Drive → GCS copy → Grant permissions → Update Firestore
                 → Gemini transcription (async)
                 → Screen share analysis (async)
```

**Idempotency is critical.** Pub/Sub guarantees at-least-once delivery, so duplicate messages are possible. We strictly maintain this order:

```typescript
async function handleRecordingGenerated(meetInfo, message) {
  // Idempotency check: skip if already processed
  if (meetInfo.recordingReady && meetInfo.artifacts?.recording?.gcsUri) {
    return;
  }

  // 1. Get file info from Drive
  const fileInfo = await getFileInfo(driveFileId);

  // 2. Stream copy to GCS (with existence check)
  if (!(await gcsFileExists(gcsPath))) {
    await copyDriveFileToGCS(fileInfo.id, gcsPath);
  }

  // 3. Grant permissions to channel members ← BEFORE setting the flag
  await shareFileWithChannelMembers(fileInfo.id, meetInfo.channelId);

  // 4. Save artifact info to Firestore
  await updateMeetSpaceArtifact(spaceName, 'recording', { driveFileId, gcsUri });

  // 5. AI processing is async fire-and-forget
  processGeminiTranscription(gcsUri, meetInfo).catch(logError);
  processScreenShareAnalysis(gcsUri, meetInfo).catch(logError);

  // 6. Check if both are ready → send Slack notification if so
  await checkAndNotifyArtifacts(spaceName);
}
```

**Why grant permissions before setting the flag?** If the flag is set first, a retry would skip via the idempotency check, and permissions would never be granted. Drive permission granting is idempotent (HTTP 400 means permission already exists), so it's safe to execute multiple times.

### ③ handleTranscriptGenerated — On Transcript Completion

Structurally mirrors the recording handler. Extracts the Google Docs transcript as text, saves to GCS, then feeds into the embedding pipeline.

### When Both Are Ready: Final Notification + Calendar Attachment

`checkAndNotifyArtifacts()` executes when both recording and transcript are Ready:

1. Send artifact notification to Slack
2. **Attach recording and transcript files to the Calendar event**
3. Grant permissions to Calendar invitees

Point 2 is key. Normally, Google Meet automatically attaches files to the Calendar event when recording and transcription complete. In our system, DWD creates the Meet under a different account, so that auto-attachment doesn't work. We **explicitly attach files via the Calendar API to preserve the same experience as default Meet**.

```typescript
async function attachFilesToCalendarEvent(event, artifacts) {
  const attachments = [];
  if (artifacts.recording) {
    attachments.push({ fileUrl: artifacts.recording.webViewLink, title: 'Recording' });
  }
  if (artifacts.transcript) {
    attachments.push({ fileUrl: artifacts.transcript.webViewLink, title: 'Transcript' });
  }

  // Deduplicate by fileUrl to be idempotent
  const existing = event.attachments ?? [];
  const newAttachments = attachments.filter(
    a => !existing.some(e => e.fileUrl === a.fileUrl)
  );

  await calendar.events.patch({
    calendarId: organizerEmail,
    eventId: event.id,
    requestBody: { attachments: [...existing, ...newAttachments] },
    supportsAttachments: true,
  });
}
```

This lets users access recordings and transcripts directly from the Calendar event detail view — whether they come via Slack or Calendar.

## Deep Dive 6: Three-Layer Permission Model

"Who gets access?" is the most delicate design point. Too narrow and it's useless; too broad and it's a security risk.


![Permission Model](/images/posts/meeting-intelligence/ll8zx1n4uhkaq3had67f.png)

### Layer 1: Slack Channel Members

When each artifact is generated, all members of the linked Slack channel get Drive viewer access.

```typescript
async function shareFileWithChannelMembers(fileId, channelId) {
  // Enumerate channel members via Slack API
  const members = await getChannelMembers(channelId);

  for (const member of members) {
    // Slack ID → Firestore → email
    const userInfo = await getUserInfo(member);
    if (!userInfo.email?.endsWith('@air-closet.com')) continue; // Domain filter

    const role = (member === organizerSlackId) ? 'writer' : 'reader';
    await shareFileWithUser(fileId, userInfo.email, role);
  }
}
```

Importantly, **members who join the channel later also get access**. Since permissions are granted using the latest member list on each Pub/Sub retry, people who joined after the meeting naturally receive access.

The organizer gets `writer` permissions, allowing them to manage the recording file (rename, change sharing settings, etc.).

### Layer 2: Meeting Participants

On meeting end, participant info from the Meet API is saved to BQ. Participants may be guests not in the Slack channel, requiring a separate permission axis from Layer 1.

### Layer 3: Calendar Invitees

When both artifacts are ready, permissions are also granted to Calendar event invitees.

```typescript
async function attachToCalendarAndShareWithAttendees(meetInfo, artifacts) {
  const event = await getCalendarEventByMeetCode(meetInfo.meetingCode);
  if (!event) return;

  // Attach files to the Calendar event
  await attachFilesToCalendarEvent(event, artifacts);

  // Grant permissions to all invitees (organizer = writer, others = reader)
  const emails = event.attendees.map(a => a.email);
  await shareFilesWithEmails(artifacts, emails, event.organizer.email);
}
```

People not in the Slack channel but on the Calendar invite (e.g., a manager who only wants to review meeting notes) also get access.

### Security Guarantees

Common security rules apply across all three layers:

- **Domain filter**: Only `@air-closet.com` email addresses are eligible. Prevents sharing with external users
- **Idempotent permission grants**: HTTP 400 (permission already exists) is not treated as an error
- **Notification suppression**: `sendNotificationEmail: false` prevents a flood of "X shared a file with you" emails

## Deep Dive 7: Embedding Generation & RAG Search Pipeline

This was the most exciting part to build.

![RAG Pipeline](/images/posts/meeting-intelligence/58to5z9rbwk0a9xscill.png)

### Three Content Sources

Up to three types of text are extracted from each meeting and vectorized separately:

| Content Type | Source | Purpose |
|-------------|--------|---------|
| `transcript` | Google Meet's native transcript (Google Docs) | Spoken word text |
| `gemini_transcript` | Gemini-generated transcript from the recording | Higher quality than native |
| `screen_share` | Gemini Vision-extracted screen share content | Slides, code, documents |

### Text Chunking: Bilingual Sentence Boundary Detection

```typescript
function chunkText(text: string, chunkSize = 1000, overlap = 100): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);

    if (end < text.length) {
      // Find a sentence boundary to avoid cutting mid-sentence
      end = findSentenceBreak(text, end, start + 100);
    }

    chunks.push(text.slice(start, end));
    start = end - overlap; // Overlap preserves context across chunks
  }
  return chunks;
}
```

`findSentenceBreak()` searches backward from the chunk boundary for sentence-ending punctuation. It supports both Japanese (`。`, `！`, `？`) and English (`. `, `! `, `? `), with fallback to spaces and fullwidth spaces. A minimum of 100 characters per chunk is enforced.

Meeting transcripts frequently mix Japanese and English, making bilingual boundary detection essential.

### Screen Share Content Extraction with Gemini

Transcripts alone miss **content shown via screen sharing** — slides, code, documents. When you need to find "that thing on the slide," it's not searchable.

We use Gemini 3 Flash (`gemini-3-flash-preview`) multimodal input to extract screen share content directly from the recording video.

```typescript
async function analyzeScreenShareFromVideo(gcsUri: string): Promise<string> {
  const result = await gemini.generateContent({
    model: GEMINI_MODEL,  // gemini-3-flash-preview
    contents: [{
      parts: [{
        fileData: { mimeType: 'video/mp4', fileUri: gcsUri },
        // Unlike transcription, video frames matter here — higher fps
        videoMetadata: { fps: 0.2 },
      }, {
        text: `Extract the content shown via screen sharing in this video.
               Transcribe any slide text, document content,
               or code that appears.`,
      }],
    }],
    generationConfig: { temperature: 0.2 },
  });
  return result.response.text();
}
```

**The fps differentiation is key.** For transcription, only audio matters, so `fps: 0.1` (1 frame per 10 seconds) minimizes video tokens. For screen share analysis, visual content matters, so `fps: 0.2` (1 frame per 5 seconds).

For long meetings that hit the input token limit, an automatic fallback splits the video into 30-minute chunks:

```typescript
async function transcribeFromVideo(gcsUri: string): Promise<string> {
  try {
    // Try processing the full video first
    return await callGemini(gcsUri);
  } catch (error) {
    if (isTokenLimitError(error)) {
      // Token limit hit → split into 30-minute chunks
      return await transcribeVideoInChunks(gcsUri, 30 * 60);
    }
    throw error;
  }
}
```

### BigQuery Vector Search

Vector data is stored in per-channel BQ tables (`meet_{channelId}`). Splitting tables by channel enables filter-free Vector Search for within-channel queries. A separate aggregated table with `channel_id` clustering handles cross-channel search.

```typescript
async function insertMeetChunks(chunks, meetInfo) {
  const channelTableId = `meet_${meetInfo.channelId}`;

  // Auto-create table if it doesn't exist (day-partitioned)
  await ensureMeetChannelTable(channelTableId);

  for (const chunk of chunks) {
    await insertRow(channelTableId, chunk);
  }
}
```

### Access Control at Search Time

```sql
SELECT
  chunkText, meetingId, channelId,
  ML.DISTANCE(text_embedding, @query_embedding, 'COSINE') AS distance
FROM `meet_chunks`
WHERE channelId IN UNNEST(@accessible_channels)  -- Access control
ORDER BY distance
LIMIT 10
```

`@accessible_channels` is **the list of Slack channel IDs the user is a member of**. Meeting content from channels you're not in will never appear in results, even if it exists in BQ.

COSINE distance is converted to a 0–1 relevance score via `1 - distance / 2`. Only chunks above the threshold are fed into Gemini's context to generate the answer.

## Deep Dive 8: GCS Operations

### Streaming Copy from Drive to GCS

Recording files can be hundreds of MBs. Loading everything into memory would exhaust Cloud Run's memory, so we stream downloads directly into uploads.

```typescript
async function copyDriveFileToGCS(driveFileId: string, gcsPath: string) {
  // Stream download from Drive API
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  // Stream upload to GCS JSON API
  await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?name=${gcsPath}&uploadType=media`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': mimeType },
      body: response.body,  // Pass ReadableStream directly
    }
  );
}
```

> **Note:** We use the GCS JSON API directly instead of `@google-cloud/storage`'s `file.save()` because the latter has a bug where multipart boundary strings get mixed into binary data during upload, corrupting recording files.

### GCS File Structure

```plaintext
gs://bucket/
└── meet/
    └── {channelId}/
        └── {spaceId}/
            ├── recording.mp4              # Recording file
            ├── transcript_original.txt    # Google Docs transcript
            ├── gemini_transcript.txt      # Gemini transcript
            └── screen_share.txt           # Screen share analysis
```

The channelId → spaceId hierarchy makes per-channel data management and lifecycle policy application straightforward. GCS lifecycle auto-deletes after 90 days (originals remain on Drive).

## Deep Dive 9: Slack Notification Design

### Two-Phase Notification

To avoid making users wait, we split notifications into two phases:

**Phase 1 (immediately after meeting end):**

```plaintext
🎬 Meeting ended

"Weekly Standup" has ended.
We'll notify you when the recording and transcript are ready.

Created by: @tanaka
```

At this point, the recording and transcript are still processing. But users can confirm that the meeting was successfully recorded.

**Phase 2 (after artifacts are ready — thread reply):**

```plaintext
📹 Recording and transcript are ready!

🎥 Recording
   https://drive.google.com/file/d/xxx

📝 Transcript
   https://docs.google.com/document/d/xxx

ℹ️ Channel members have viewing access
```

Phase 2 is sent as a **thread reply** to Phase 1. The Phase 1 message's `ts` (timestamp) is saved to Firestore and used as the thread parent for Phase 2.

## Observability: OpenTelemetry + Grafana + Prometheus

All processing in this system is instrumented with **OpenTelemetry** and aggregated in **Grafana**. Meet Space creation, Pub/Sub event processing, Drive→GCS copy, embedding generation, Slack notifications — latency and error rates for each step are visible on a single dashboard.

Through the Grafana MCP introduced in the [previous article](/posts/17-mcp-servers), these logs and metrics are also accessible via MCP. Investigations like "Show me error logs from yesterday's Meet pipeline" can be done directly from Claude Code.

For Gemini API costs, we track actual usage and costs via **Prometheus**. Token consumption for transcription and screen share analysis is visualized in real-time, so cost anomalies are caught immediately.

## Beyond: Meeting Data as a Project Knowledge Base

The system described so far is about "sharing and searching meeting recordings and transcripts." But this data is already being leveraged in a broader context.

### Project-Level Meeting Data Integration

At airCloset, Slack channels are created per project. The mapping between channels and projects is managed in Firestore, and through our Project Management MCP (described in the [previous article](/posts/17-mcp-servers)), **meeting data linked to a project is searchable via MCP**.

For example, "Tell me what was discussed about this spec in Project X's past meetings" searches all meeting transcripts from that project's Slack channel and returns relevant excerpts.

### Unified Search with Slack Messages

Beyond meeting transcripts, **Slack messages themselves are also stored and vectorized in BigQuery** using the same approach. The same MCP can search across both meeting content and Slack discussions.

What was decided in a meeting and how it was implemented in Slack afterward. Conversely, what was debated in Slack and which meeting made the final call. **Being able to search across meetings and chat as two unified communication channels** is remarkably powerful in practice.

### Exploring Code Review Integration

We're currently exploring whether **business context from meeting and Slack data could be used for specification checks during code reviews**.

If we could automatically surface meeting decisions and Slack spec discussions related to code changes in a PR, and verify "Is this change consistent with the spec decided in the meeting on date X?" during review, we might be able to prevent bugs caused by misunderstood requirements. It's still in the conceptual stage, but the potential for meeting data utilization continues to expand.

## Summary: Maximizing Meeting Value

Here's what this system achieves:

| Problem | Solution |
|---------|----------|
| Effort of writing meeting notes | Auto-transcribed and auto-shared |
| Effort of rewatching recordings | Ask in natural language, get a summary |
| Effort of managing permissions | Auto-granted to channel members, participants, and invitees |
| Effort of creating Meets | One click from the Chrome extension |
| "What was that thing we discussed?" | Instantly found via RAG search |
| Screen-shared content not preserved | Auto-extracted by Gemini Vision |

Technical highlights:

- **LIFO cache** bringing Meet Space creation to under 100ms
- **Chrome Extension** placing features on users' existing workflow, dramatically boosting adoption
- **Domain-Wide Delegation** solving the file ownership problem
- **Workspace Events API** + daily batch covering the 7-day TTL constraint
- **Idempotent event processing** handling Pub/Sub's at-least-once delivery
- **Three-layer permission model** ensuring access for all stakeholders
- **Per-channel table strategy** enabling both scoped and cross-channel search
- **Gemini Vision fps differentiation** optimizing transcription and screen share analysis costs

Meetings are a treasure trove of information. Letting that information sleep is a waste.

**Google Workspace × GCP × Slack** — maximizing the value of every meeting. I hope this helps anyone facing similar challenges.

## References

- [Google Workspace Events API](https://developers.google.com/workspace/events)
- [Google Meet REST API](https://developers.google.com/meet/api/reference/rest)
- [Domain-Wide Delegation](https://developers.google.com/identity/protocols/oauth2/service-account#delegatingauthority)
- [Vertex AI Embeddings](https://cloud.google.com/vertex-ai/docs/generative-ai/embeddings/get-text-embeddings)
- [BigQuery Vector Search](https://cloud.google.com/bigquery/docs/vector-search)
- [Chrome Extension Manifest V3](https://developer.chrome.com/docs/extensions/develop)
