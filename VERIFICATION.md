# Verification record

Raw output captured while this project was built and deployed, kept as recorded.
Every check ran on the machine and against the versions stated in the README.

**Identifiers are redacted.** Session ids, the filesystem owner, and the digest
and filename of one personal attachment are replaced with placeholders. Nothing
else in this file is altered.

Two notes, so the raw output is not misread:

- In `--- post-restart state ---`, the line `same-origin: DIFFERS` is from a run
  whose input (`manifest-stage.txt`) was not present in the working directory at
  that moment, so the comparison never executed. The same-origin check that did run
  is recorded below under `=== pinning outcome ===` as `IDENTICAL`, and was
  re-verified after every subsequent change.
- In `=== pending ===`, the GUI upload is listed as deferred. It was performed
  afterwards; its result is the `=== end-to-end attachment (real GUI upload) ===`
  section directly beneath it.

---

Termux verification report (clean rebuild + clean install)
date      : 2026-09-26T10:48:44+08:00
dsh       : 0.1.7-rc.2
bin       : ../lib/node_modules/dsh-termux/lib/termux-bin.js
tree      : /data/data/com.termux/files/usr/lib/node_modules/dsh-termux
same-origin: built tree == deployed tree (25859 entries, byte-identical)

--- sandbox + attachments ---
==============================================================
1. Landlock sandbox (expected: unavailable, degrading quietly)
==============================================================
PASS  launcherPath() returns the documented fallback
         /data/data/com.termux/files/usr/lib/node_modules/dsh-termux/vendor/node-addon-system-android-arm64/bin/landlock-run
PASS  that fallback does not exist on Android
         no landlock launcher binary is shipped or buildable for android/arm64
PASS  grantArgs() emits the launcher flag shape
         ["--ro","/ro","--rw","/rw"]
PASS  probe() reports unusable instead of throwing
         verdict = unusable
PASS  LocalSandboxProvider constructs on Android
         instance of LocalSandboxProvider

==============================================================
2. Attachment publish chain (both link(2) fallback sites)
==============================================================
PASS  LocalAttachmentStore constructs
         root = /data/data/com.termux/files/usr/lib/node_modules/verify-tmp/attachments/v1
PASS  saveFile publishes (publishImmutableObject + publishImmutableAlias)
         ref = sha256:642f76bad393fadb7b5ef7e59786df8c37c2f7e57be92ae6687fa7894683540b name=note.txt bytes=1664
PASS  republishing identical bytes dedupes via the EEXIST path
         same attachmentId = true
PASS  readFileStream round-trips the bytes
         1664 bytes
PASS  published object has link count 1 (copy, not hard link)
         2 files under the store root
PASS  saveImage works (sharp via the wasm32 fallback)
         ref = sha256:3ea65981f46e62c2893f6d4affca5d324b7b7a5006982183672631c00d19e3d8 mediaType=image/png bytes=184
PASS  stored image is readable and non-empty
         184 bytes on disk

==============================================================
12/12 checks passed
VERDICT: PASS

--- flock ---
RESULT: flock acquired OK

--- hard-link primitives ---
PASS  link(2) is denied on this filesystem -- code=EACCES
PASS  rename publishes and drops the staged name
PASS  O_EXCL claim publishes and refuses a second claim -- second=EEXIST
PASS  COPYFILE_EXCL publishes and refuses an existing target -- second=EEXIST

4/4 primitive checks passed

--- keyless agent loop ---
mock llm listening at http://127.0.0.1:38113
--- dsh headless stdout ---
PONG-FROM-MOCK-LLM
--- mock server saw ---
requests: 2
  attempt 1: success -> completed
  attempt 2: success -> completed
---------------------------------------------
exit code     : 0 (signal null)
marker echoed : true
VERDICT       : PASS

--- live session state ---
/data/data/com.termux/files/home/.dsh/sessions/--data-data-com.termux-files-home--/<session-id-1>/:
-rw-------. 1 <uid> <uid>  317 22:29:05 session.jsonl.zstd
/data/data/com.termux/files/home/.dsh/sessions/--data-data-com.termux-files-home--/<session-id-2>/:
-rw-------. 1 <uid> <uid> 1855828 23:09:06 session.jsonl.zstd
-rw-------. 1 <uid> <uid>       0 10:43:47 session.lock
-rw-------. 1 <uid> <uid>  939023 10:48:44 session.v4.jsonl.zstd

--- live attachment check (real ~/.dsh) ---
DSH_HOME      : /data/data/com.termux/files/home/.dsh
store root    : /data/data/com.termux/files/home/.dsh/attachments/v1
pre-existing  : 0 files, 0 dirs (store root existed: false)
resolved root : /data/data/com.termux/files/home/.dsh/attachments/v1
PASS  saveImage against the real ~/.dsh
         sha256:6f4913805c680083d3948b610acbe1cba1fc165a671c8d17f1d1b0ba96241ead (987 bytes)
PASS  stored image reads back
         987 bytes
PASS  saveFile + readFileStream round-trip
         sha256:75d3ff4a64c90da477531413eb9c0ace7e821d51965df53caecaba4b1e170887

created 3 file(s) and 9 dir(s); removing them
PASS  live store left exactly as found (root, files and dirs)
         store root existed false before, false after; 0 leftovers expected

4/4 checks passed
VERDICT: PASS

--- post-restart state ---
dsh        : 0.1.7-rc.2
bin        : ../lib/node_modules/dsh-termux/lib/termux-bin.js
deployed   : 328M
diff: manifest-stage.txt: No such file or directory
same-origin: DIFFERS
attachments: ~/.dsh/attachments absent

=== pinning outcome ===
pin sha256  : 7e6e4f7b37298a20
differing entries, npm install (unpinned) vs npm install : 44
differing entries, npm ci (pinned)     vs npm install : 1 (this repo's own new verify script)
install time: npm install ~2-3 min -> npm ci ~23 s
deployed tree == build output: IDENTICAL

=== pending ===
GUI-composer attachment upload: deferred by user; baseline recorded in attach-before.json

=== end-to-end attachment (real GUI upload) ===
store root      : /data/data/com.termux/files/home/.dsh/attachments (existed at baseline: false)
new object files: 1
     118795  v1/objects/<xx>/<digest>
PASS  the store gained objects
         1 new file(s)
PASS  a new object decodes as an image
         jpeg 118795B  <digest>
session         : <session-id-2> / session.v4.jsonl.zstd
frames decoded  : 361
events          : 1622
PASS  session log references the stored digest
         digest <digest> appears in the log
PASS  log carries a structural attachment record
         2 event(s): agent/inbox/spliced, user/message
         "attachment":{"attachmentId":"sha256:<digest>","mediaType":"image/jpeg","width":960,"height":960,"bytes":118795,"name":"<uploaded-name>.png"}

4/4 checks passed
VERDICT: PASS

=== distribution packaging ===
archive : dist/dsh-termux-0.1.7-rc.2-termux.1-android-arm64.tar.gz
digest  : 155ce376a7f80108ab96ff68ffe0ae59213d6b5707d7273d4f36961e988ee9ca
size    : 61M (from 331M)
selected native files: 5, all aarch64; inert foreign prebuilds: 7

verified by extracting OUTSIDE the build workspace:
  sha256sum -c SHA256SUMS     : 0 failures / 25848 files
  shipped scripts referencing the build workspace: 0
  install into empty prefix   : ok
  dsh --version               : 0.1.7-rc.2
  verify-termux.mjs           : 12/12 PASS
  e2e-mock.mjs (agent loop)   : PASS
