import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { initialLibrary } from "./videoLibrary.js";
import "./styles.css";

const SETTINGS_PIN_KEY = "kidsTubePin";
const ADDED_LIBRARY_KEY = "kidsTubeAddedLibrary";
const LEGACY_LIBRARY_KEY = "kidsTubeLibrary";
const YOUTUBE_API_KEY = "kidsTubeYouTubeApiKey";
const SELECTED_ITEM_KEY = "kidsTubeSelectedItem";
const DEFAULT_PIN = "1234";
const removedSampleIds = new Set(["sample-video", "sample-playlist", "sample-learning"]);

const cardColors = [
  "linear-gradient(135deg, #54c6eb, #7ed957)",
  "linear-gradient(135deg, #ff8a65, #ffd166)",
  "linear-gradient(135deg, #a78bfa, #f472b6)",
  "linear-gradient(135deg, #5eead4, #60a5fa)",
  "linear-gradient(135deg, #fda4af, #fde047)"
];

function readJsonArray(key) {
  try {
    const saved = localStorage.getItem(key);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadAddedLibrary() {
  if (localStorage.getItem(ADDED_LIBRARY_KEY) !== null) {
    const added = readJsonArray(ADDED_LIBRARY_KEY).filter((item) => !removedSampleIds.has(item.id));
    saveAddedLibrary(added);
    return added;
  }

  const legacy = readJsonArray(LEGACY_LIBRARY_KEY);
  const migrated = legacy.filter(
    (item) => !initialLibrary.some((initial) => initial.id === item.id) && !removedSampleIds.has(item.id)
  );
  saveAddedLibrary(migrated);
  return migrated;
}

function saveAddedLibrary(items) {
  localStorage.setItem(ADDED_LIBRARY_KEY, JSON.stringify(items));
}

function mergeLibrary(initialItems, addedItems) {
  const seenUrls = new Set();
  return [...initialItems, ...addedItems].filter((item) => {
    if (!item.url) return true;
    if (seenUrls.has(item.url)) return false;
    seenUrls.add(item.url);
    return true;
  });
}

function flattenLibrary(items) {
  return items.flatMap((item) => [item, ...flattenLibrary(item.items || [])]);
}

function parseYouTubeUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace("www.", "");
    const list = parsed.searchParams.get("list");

    if (!["youtube.com", "m.youtube.com", "youtu.be", "youtube-nocookie.com"].includes(host)) {
      return { type: "unknown" };
    }

    if (host === "youtu.be") {
      return { type: "video", videoId: parsed.pathname.slice(1), list };
    }

    if (parsed.pathname.startsWith("/shorts/")) {
      return { type: "video", videoId: parsed.pathname.split("/")[2], list };
    }

    if (parsed.pathname.startsWith("/embed/videoseries") && list) {
      return { type: "playlist", list };
    }

    if (parsed.pathname.startsWith("/embed/")) {
      return { type: "video", videoId: parsed.pathname.split("/")[2], list };
    }

    const videoId = parsed.searchParams.get("v");
    if (videoId) return { type: "video", videoId, list };
    if (list) return { type: "playlist", list };
  } catch {
    return { type: "unknown" };
  }

  return { type: "unknown" };
}

function createAddedVideo(url, title, index) {
  const details = parseYouTubeUrl(url);
  if (details.type === "unknown" || !details.videoId) return null;

  return {
    id: `added-${Date.now()}-${details.videoId}`,
    title: title || "動画",
    kind: "video",
    url,
    color: cardColors[index % cardColors.length],
    source: "parent"
  };
}

async function fetchYouTubeJson(url) {
  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok) {
    const message = data.error?.message || "YouTube APIでエラーが起きました";
    throw new Error(message);
  }
  return data;
}

async function createAddedPlaylist(url, title, index, apiKey) {
  const details = parseYouTubeUrl(url);
  const playlistId = details.list;
  if (!playlistId) return null;
  if (!apiKey) throw new Error("missing-api-key");

  const playlistParams = new URLSearchParams({
    part: "snippet",
    id: playlistId,
    key: apiKey
  });
  const playlistData = await fetchYouTubeJson(`https://www.googleapis.com/youtube/v3/playlists?${playlistParams}`);
  const playlistTitle = playlistData.items?.[0]?.snippet?.title || "プレイリスト";

  if (!playlistData.items?.length) {
    throw new Error("再生リストが見つかりませんでした");
  }

  const children = [];
  let pageToken = "";

  do {
    const params = new URLSearchParams({
      part: "snippet,contentDetails",
      maxResults: "50",
      playlistId,
      key: apiKey
    });
    if (pageToken) params.set("pageToken", pageToken);

    const data = await fetchYouTubeJson(`https://www.googleapis.com/youtube/v3/playlistItems?${params}`);

    for (const entry of data.items || []) {
      const videoId = entry.contentDetails?.videoId || entry.snippet?.resourceId?.videoId;
      const videoTitle = entry.snippet?.title || "動画";
      if (!videoId || videoTitle === "Deleted video" || videoTitle === "Private video") continue;

      const thumbnails = entry.snippet?.thumbnails || {};
      children.push({
        id: `added-${playlistId}-${videoId}-${children.length}`,
        title: videoTitle,
        kind: "video",
        url: `https://www.youtube.com/watch?v=${videoId}&list=${playlistId}`,
        thumbnailUrl: thumbnails.high?.url || thumbnails.medium?.url || thumbnails.default?.url || "",
        color: cardColors[(index + children.length) % cardColors.length],
        source: "parent-child"
      });
    }

    pageToken = data.nextPageToken || "";
  } while (pageToken);

  if (children.length === 0) {
    throw new Error("子動画を取得できませんでした");
  }

  return {
    id: `added-${Date.now()}-${playlistId}`,
    title: title || playlistTitle,
    kind: "playlist",
    url,
    color: cardColors[index % cardColors.length],
    source: "parent",
    items: children
  };
}

function createEmbedUrl(item) {
  const details = parseYouTubeUrl(item.url);
  const baseParams = new URLSearchParams({
    rel: "0",
    modestbranding: "1",
    playsinline: "1",
    controls: "1"
  });

  if (details.type === "playlist") {
    baseParams.set("listType", "playlist");
    baseParams.set("list", details.list);
    return `https://www.youtube-nocookie.com/embed/videoseries?${baseParams}`;
  }

  if (details.type === "video" && details.videoId) {
    if (details.list) baseParams.set("list", details.list);
    return `https://www.youtube-nocookie.com/embed/${details.videoId}?${baseParams}`;
  }

  return "";
}

function createThumbnailUrl(item) {
  if (item.thumbnailUrl) return item.thumbnailUrl;

  const details = parseYouTubeUrl(item.url);
  if (!details.videoId) return "";

  return `https://i.ytimg.com/vi/${details.videoId}/hqdefault.jpg`;
}

function readSelectedItem(id) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SELECTED_ITEM_KEY) || "null");
    return saved?.id === id ? saved : null;
  } catch {
    return null;
  }
}

function makeRoute() {
  const hash = window.location.hash.replace("#", "");
  if (hash.startsWith("/watch/")) return { page: "watch", id: hash.split("/")[2] };
  if (hash.startsWith("/playlist/")) return { page: "playlist", id: hash.split("/")[2] };
  if (hash === "/settings") return { page: "settings" };
  return { page: "home" };
}

function App() {
  const [route, setRoute] = useState(makeRoute);
  const [addedLibrary, setAddedLibrary] = useState(loadAddedLibrary);
  const library = useMemo(() => mergeLibrary(initialLibrary, addedLibrary), [addedLibrary]);
  const allItems = useMemo(() => flattenLibrary(library), [library]);

  React.useEffect(() => {
    const onHashChange = () => setRoute(makeRoute());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  React.useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  const selectedVideo = useMemo(
    () => allItems.find((item) => item.id === route.id) || readSelectedItem(route.id),
    [allItems, route.id]
  );

  return (
    <main className="app-shell">
      {route.page === "watch" && selectedVideo ? (
        <WatchPage video={selectedVideo} />
      ) : route.page === "playlist" && selectedVideo ? (
        <PlaylistPage playlist={selectedVideo} />
      ) : route.page === "settings" ? (
        <ParentSettings addedLibrary={addedLibrary} setAddedLibrary={setAddedLibrary} />
      ) : (
        <HomePage library={library} />
      )}
    </main>
  );
}

function openItem(item) {
  if (item.kind === "playlist") {
    sessionStorage.setItem(SELECTED_ITEM_KEY, JSON.stringify(item));
    window.location.hash = `/playlist/${item.id}`;
    return;
  }

  sessionStorage.setItem(SELECTED_ITEM_KEY, JSON.stringify(item));
  window.location.hash = `/watch/${item.id}`;
}

function VideoGrid({ library }) {
  return (
    <div className="video-grid">
      {library.map((item) => {
        const thumbnailUrl = createThumbnailUrl(item);

        return (
          <button
            className="video-card"
            type="button"
            key={item.id}
            onClick={() => openItem(item)}
          >
            <span className="cover" style={{ background: item.color }}>
              {thumbnailUrl && <img src={thumbnailUrl} alt="" loading="lazy" />}
              <span className="play-badge">▶</span>
            </span>
            <span className="card-title">{item.title}</span>
            <span className="card-meta">
              {item.kind === "playlist"
                ? `${item.items?.length || item.expectedCount ? `${item.items?.length || item.expectedCount}こ ` : ""}プレイリスト`
                : "どうが"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function HomePage({ library }) {
  return (
    <section className="screen home-screen">
      <header className="top-bar">
        <div>
          <p className="eyebrow">Kids Tube</p>
          <h1>みたいものをえらんでね</h1>
        </div>
      </header>

      {library.length === 0 ? (
        <div className="empty-home">まだカードがありません</div>
      ) : (
        <VideoGrid library={library} />
      )}
    </section>
  );
}

function PlaylistPage({ playlist }) {
  const [loadedItems, setLoadedItems] = useState(playlist.items || []);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const visibleItems = loadedItems.length ? loadedItems : playlist.items || [];

  React.useEffect(() => {
    setLoadedItems(playlist.items || []);
    setMessage("");

    if (playlist.items?.length || !parseYouTubeUrl(playlist.url).list) return;

    const apiKey = localStorage.getItem(YOUTUBE_API_KEY) || "";
    if (!apiKey) {
      setMessage("子カードを表示するには、親設定でYouTube APIキーを保存してください。");
      return;
    }

    let isActive = true;
    setIsLoading(true);
    setMessage("子カードを読み込んでいます...");

    createAddedPlaylist(playlist.url, playlist.title, 0, apiKey)
      .then((item) => {
        if (!isActive) return;
        setLoadedItems(item.items || []);
        setMessage("");
      })
      .catch((error) => {
        if (!isActive) return;
        setMessage(`子カードを読み込めませんでした: ${error.message}`);
      })
      .finally(() => {
        if (isActive) setIsLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [playlist]);

  return (
    <section className="screen home-screen">
      <header className="player-header">
        <button className="back-button" type="button" onClick={() => (window.location.hash = "/")}>
          ← もどる
        </button>
        <h1>{playlist.title}</h1>
      </header>

      <button className="wide-action-button" type="button" onClick={() => (window.location.hash = `/watch/${playlist.id}`)}>
        プレイリストを再生
      </button>

      {message && <p className="message playlist-message">{message}</p>}

      {visibleItems.length ? (
        <VideoGrid library={visibleItems} />
      ) : isLoading ? (
        <div className="empty-home">読み込み中...</div>
      ) : (
        <div className="empty-home">まだカードがありません</div>
      )}
    </section>
  );
}

function WatchPage({ video }) {
  const embedUrl = createEmbedUrl(video);

  return (
    <section className="screen watch-screen">
      <header className="player-header">
        <button className="back-button" type="button" onClick={() => (window.location.hash = "/")}>
          ← もどる
        </button>
        <h1>{video.title}</h1>
      </header>

      <div className="player-frame">
        {embedUrl ? (
          <iframe
            title={video.title}
            src={embedUrl}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        ) : (
          <div className="player-error">このURLは再生できません。</div>
        )}
      </div>
    </section>
  );
}

function ParentSettings({ addedLibrary, setAddedLibrary }) {
  const [pinInput, setPinInput] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [pinDraft, setPinDraft] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState(() => localStorage.getItem(YOUTUBE_API_KEY) || "");
  const [titleInput, setTitleInput] = useState("");
  const [urlInput, setUrlInput] = useState("");

  const unlock = (event) => {
    event.preventDefault();
    const savedPin = localStorage.getItem(SETTINGS_PIN_KEY) || DEFAULT_PIN;
    if (pinInput === savedPin) {
      setIsUnlocked(true);
      setMessage("");
      return;
    }
    setMessage("PINがちがいます");
  };

  const savePin = () => {
    if (!/^\d{4,8}$/.test(pinDraft)) {
      setMessage("PINは4から8けたの数字にしてください");
      return;
    }
    localStorage.setItem(SETTINGS_PIN_KEY, pinDraft);
    setPinDraft("");
    setMessage("PINを保存しました");
  };

  const saveApiKey = () => {
    localStorage.setItem(YOUTUBE_API_KEY, apiKeyInput.trim());
    setMessage("YouTube APIキーを保存しました");
  };

  const addUrl = async (event) => {
    event.preventDefault();
    const title = titleInput.trim();
    const url = urlInput.trim();
    const details = parseYouTubeUrl(url);

    if (details.type === "unknown") {
      setMessage("YouTube動画URLまたは再生リストURLを入力してください");
      return;
    }

    setIsSaving(true);
    setMessage("追加しています...");

    try {
      const apiKey = localStorage.getItem(YOUTUBE_API_KEY) || "";
      const item = details.list
        ? await createAddedPlaylist(url, title, addedLibrary.length, apiKey)
        : createAddedVideo(url, title, addedLibrary.length);

      if (!item) {
        setMessage("このURLは追加できませんでした");
        return;
      }

      const nextItems = [...addedLibrary, item];
      setAddedLibrary(nextItems);
      saveAddedLibrary(nextItems);
      setTitleInput("");
      setUrlInput("");
      setMessage(item.kind === "playlist" ? "親カードと子カードを追加しました" : "動画を追加しました");
    } catch (error) {
      if (error.message === "missing-api-key") {
        setMessage("再生リストの自動取得にはYouTube APIキーを保存してください");
      } else {
        setMessage(`再生リストを取得できませんでした: ${error.message}`);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const renameUrl = (id, title) => {
    const nextItems = addedLibrary.map((item) => (item.id === id ? { ...item, title } : item));
    setAddedLibrary(nextItems);
    saveAddedLibrary(nextItems);
  };

  const rebuildChildCards = async (id) => {
    const target = addedLibrary.find((item) => item.id === id);
    if (!target) return;

    const details = parseYouTubeUrl(target.url);
    if (!details.list) {
      setMessage("このURLには再生リストIDがありません");
      return;
    }

    const apiKey = localStorage.getItem(YOUTUBE_API_KEY) || "";
    setIsSaving(true);
    setMessage("子カードを作成しています...");

    try {
      const rebuilt = await createAddedPlaylist(
        target.url,
        target.title,
        addedLibrary.findIndex((item) => item.id === id),
        apiKey
      );

      const nextItems = addedLibrary.map((item) =>
        item.id === id ? { ...rebuilt, id: item.id, title: item.title } : item
      );
      setAddedLibrary(nextItems);
      saveAddedLibrary(nextItems);
      setMessage("子カードを作成しました");
    } catch (error) {
      if (error.message === "missing-api-key") {
        setMessage("子カード作成にはYouTube APIキーを保存してください");
      } else {
        setMessage(`子カードを作成できませんでした: ${error.message}`);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const deleteUrl = (id) => {
    const nextItems = addedLibrary.filter((item) => item.id !== id);
    setAddedLibrary(nextItems);
    saveAddedLibrary(nextItems);
    setMessage("削除しました");
  };

  if (!isUnlocked) {
    return (
      <section className="screen settings-screen">
        <header className="player-header">
          <button className="back-button" type="button" onClick={() => (window.location.hash = "/")}>
            ← もどる
          </button>
          <h1>親設定</h1>
        </header>

        <form className="pin-panel" onSubmit={unlock}>
          <label htmlFor="pin">PIN</label>
          <input
            id="pin"
            inputMode="numeric"
            type="password"
            value={pinInput}
            onChange={(event) => setPinInput(event.target.value)}
            placeholder="1234"
            autoComplete="current-password"
          />
          <button className="primary-button" type="submit">開く</button>
          <p className="setting-note">初期PINは 1234 です。</p>
          {message && <p className="message">{message}</p>}
        </form>
      </section>
    );
  }

  return (
    <section className="screen settings-screen">
      <header className="player-header">
        <button className="back-button" type="button" onClick={() => (window.location.hash = "/")}>
          ← もどる
        </button>
        <h1>親設定</h1>
      </header>

      <div className="settings-stack">
        <section className="settings-panel">
          <h2>YouTube APIキー</h2>
          <div className="inline-form">
            <input
              type="password"
              value={apiKeyInput}
              onChange={(event) => setApiKeyInput(event.target.value)}
              placeholder="APIキー"
            />
            <button className="primary-button" type="button" onClick={saveApiKey}>保存</button>
          </div>
          <p className="setting-note">再生リストの子カード自動作成に使います。この端末だけに保存されます。</p>
        </section>

        <section className="settings-panel">
          <h2>URLを追加</h2>
          <form className="add-url-form" onSubmit={addUrl}>
            <label htmlFor="card-title">親カード名</label>
            <input
              id="card-title"
              type="text"
              value={titleInput}
              onChange={(event) => setTitleInput(event.target.value)}
              placeholder="空ならYouTubeの再生リスト名を使います"
            />
            <label htmlFor="youtube-url">YouTube動画URL・再生リストURL</label>
            <input
              id="youtube-url"
              type="url"
              value={urlInput}
              onChange={(event) => setUrlInput(event.target.value)}
              placeholder="https://www.youtube.com/playlist?list=..."
            />
            <button className="primary-button" type="submit" disabled={isSaving}>
              {isSaving ? "追加中..." : "保存して追加"}
            </button>
          </form>
        </section>

        <section className="settings-panel">
          <h2>追加済みURL</h2>
          {addedLibrary.length === 0 ? (
            <p className="setting-note">まだ追加されたURLはありません。</p>
          ) : (
            <div className="registered-list">
              {addedLibrary.map((item) => (
                <article className="registered-item" key={item.id}>
                  <div>
                    <label htmlFor={`title-${item.id}`}>親カード名</label>
                    <input
                      id={`title-${item.id}`}
                      type="text"
                      value={item.title}
                      onChange={(event) => renameUrl(item.id, event.target.value)}
                    />
                    <span>{item.kind === "playlist" ? `${item.items?.length || 0}こ プレイリスト` : "どうが"}</span>
                    <p>{item.url}</p>
                  </div>
                  <div className="registered-actions">
                    {parseYouTubeUrl(item.url).list && (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={isSaving}
                        onClick={() => rebuildChildCards(item.id)}
                      >
                        子カード作成
                      </button>
                    )}
                    <button className="danger-button" type="button" onClick={() => deleteUrl(item.id)}>
                      削除
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="settings-panel">
          <h2>PIN変更</h2>
          <div className="inline-form">
            <input
              inputMode="numeric"
              type="password"
              value={pinDraft}
              onChange={(event) => setPinDraft(event.target.value)}
              placeholder="新しいPIN"
            />
            <button className="primary-button" type="button" onClick={savePin}>保存</button>
          </div>
        </section>

        {message && <p className="message">{message}</p>}
      </div>
    </section>
  );
}

createRoot(document.getElementById("root")).render(<App />);
