# UUID2Asset
A tool made to decrypt Cocos Creator HTML5 asset UUIDs back to their original form and download them.

> [!NOTE]  
> Automatic mode has been removed because it only worked in debug HTML5 builds (rarely seen) and was somewhat unstable. If you still want to use it, check out the "auto" branch.

## How to use?

```node u2a.js https://example.com/v1/ config.XXXX.json```

## Requirements:

- node-fetch
- jszip
  
## How to get a bundle configuration file?

On the game URL, type `view-source:` *before* the HTTP indentifier, this will open the page's source code.

Scroll down a little bit until you find something like this:

`<script src="src/settings.RANDOMHASH.js" charset="utf-8"></script>`

You will see an hyperlink between the `src=` attribute, click it and it will open a json file like the one in the below image:

![image](https://github.com/user-attachments/assets/d99e719d-7120-459f-91fb-d37c35d230ef)

> [!NOTE]  
> In some builds, the settings file won't contain the bundle hashes. You can download them via the Network tab while booting the game.

See the `bundleVers` key? well that's what we are searching for, copy the name of the bundle and the hash of the bundle you want to archive and put these in this link:

`{gamelinkhere}/assets/BUNDLENAMEHERE/config.BUNDLEHASHHERE.json`

Press enter and it will open another JSON file, right click and click `Save as...` button and save it on the root of the tool directory.

Done, you downloaded the bundle configuration files, now you can start using the tool.

## Extras

`${serverName}/assets/${bundleData.name}/${base}/${firstTwoChars}/${decryptedUuid}.${hash}${ext}`

https://forum.cocos.org/t/uuid/96047

https://docs.cocos.com/creator/3.4/api/en/core/Function/decodeUuid

https://github.com/nmhung1210/cocos-creator/blob/1e1300bef05b8ab4a9e33944b7bcbe5e684d7eb6/engine/cocos2d/core/utils/decode-uuid.js#L4
