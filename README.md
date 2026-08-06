# Walkthrough Studio — AI-generated version (Higgsfield)

Floor-plan-based room ordering + real AI-generated camera motion through
each room and doorway, via Higgsfield's API.

## Before you start — read this

- **This costs money to run.** Every room clip and every doorway transition
  is a paid Higgsfield generation. Test with a cheap/small job first (2-3
  rooms) before running a full property, so you know your real cost per
  video before quoting clients.
- **I have not been able to run this against the live Higgsfield API** — I
  don't have internet access in the environment I built this in. The code
  is real and the logic is tested (uploads, floor-plan ordering, job
  polling, video stitching), but the exact Higgsfield endpoint paths and
  field names in `lib/higgsfield.js` are reconstructed from public
  documentation and may need small adjustments once you have real API
  access and can see your dashboard's exact API reference. Budget time for
  a first test run that might need a tweak or two — see "If something
  doesn't work" below.
- **Turnaround is real-world minutes, not seconds.** Each room and each
  transition is a separate AI generation (~30-60+ seconds each typically).
  A 5-room property is roughly 9 generations in sequence — expect several
  minutes end to end.

## What you need before deploying

1. A Higgsfield account with API access and an API key (cloud.higgsfield.ai).
2. A free or low-cost hosting account. **Render.com** is the easiest for
   this — it builds directly from the Dockerfile included here, so ffmpeg
   comes pre-installed with no extra setup.
3. This project uploaded somewhere Render can pull from — the simplest way
   is a free GitHub account with this folder pushed as a new repository.

## Deploy steps (Render.com)

1. Create a free GitHub account if you don't have one, create a new empty
   repository, and upload this whole `walkthrough-backend` folder to it
   (GitHub's web upload works fine for this — no command line needed).
2. Go to render.com, sign up, click **New > Web Service**, and connect the
   GitHub repository you just created.
3. Render will detect the `Dockerfile` automatically — leave the build
   settings on their defaults.
4. Under **Environment**, add these variables:
   - `HIGGSFIELD_API_KEY` — your real API key
   - `PUBLIC_BASE_URL` — leave blank for now; after the first deploy, Render
     shows you the live URL (like `https://walkthrough-studio.onrender.com`)
     — come back and set this variable to that exact URL, then redeploy.
     This step matters: Higgsfield needs to fetch your uploaded photos back
     from this server, so it must know the server's real public address.
5. Click **Create Web Service**. First deploy takes a few minutes.
6. Once it's live, open the URL in your browser — that's the app.

## Using it

1. Upload room photos, label them.
2. Upload your floor plan, tap to place each room, optionally connect
   doorways, tap **Auto-arrange walkthrough order**.
3. Adjust the motion prompts if you want a different camera feel than the
   default "drone glide" description.
4. Click **Generate walkthrough** and wait — the progress bar shows which
   room/transition is currently generating.
5. Download the finished video when it's done.

## If something doesn't work

The most likely failure point is `lib/higgsfield.js` not matching your
account's exact API shape. If a generation fails:

1. Check the Render service logs (Render's dashboard has a **Logs** tab) —
   the error message will include Higgsfield's actual response, which
   usually tells you exactly what field name or endpoint is wrong.
2. Compare that against your Higgsfield dashboard's API reference.
3. Adjust the constants at the top of `lib/higgsfield.js`
   (`HIGGSFIELD_BASE_URL`, `HIGGSFIELD_GENERATE_PATH`, `HIGGSFIELD_MODEL`,
   etc. — these can also be set as environment variables in Render without
   touching the code) and redeploy.

If you get stuck on an error message, paste it back to me — I can adjust
the code to match.

## Cost control tips

- Start with `HIGGSFIELD_MODEL=dop-lite` (cheaper/faster tier) while
  testing, switch to `dop-preview` or higher once you trust the pipeline.
- Keep `roomDurationSeconds` and `transitionDurationSeconds` as low as
  looks good — cost scales with generated seconds.
- Test on a 2-3 room set before ever running a real client's full property.
