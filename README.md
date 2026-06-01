# Kids Tube

子供用YouTubeビューアのPWAです。

## 使い方

```bash
npm install
npm run dev
```

Androidなど同じWi-Fi内の別端末から開く場合も `npm run dev` で起動できます。

開発サーバーのポートは `5190` 固定です。

PC:

```text
http://127.0.0.1:5190/
```

Android Brave:

```text
http://192.168.2.105:5190/
```

親設定:

```text
http://192.168.2.105:5190/#/settings
```


## 動画配列

動画とプレイリストは `src/videoLibrary.js` の `initialLibrary` 配列で管理します。

親設定の初期PINは `1234` です。親設定ではPIN変更と、この端末向けのYouTube動画URL・再生リストURLの追加/削除ができます。
親設定は `/#/settings` で開けます。

子供用ホーム画面には、`src/videoLibrary.js` の初期動画と、親設定で追加して `localStorage` に保存された動画が合体して表示されます。

## 再生リスト内カード

固定リストの再生リストに `items` を追加すると、カードを開いた先に動画カード一覧を表示できます。

```js
{
  id: "playlist-id",
  title: "プレイリスト名",
  kind: "playlist",
  url: "https://www.youtube.com/playlist?list=...",
  color: "linear-gradient(135deg, #ff8a65, #ffd166)",
  items: [
    {
      id: "playlist-video-1",
      title: "動画名",
      kind: "video",
      url: "https://www.youtube.com/watch?v=...",
      color: "linear-gradient(135deg, #54c6eb, #7ed957)"
    }
  ]
}
```
