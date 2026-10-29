# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/09a14ae7-bd4a-415b-b22e-66bbeb1a9240

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/09a14ae7-bd4a-415b-b22e-66bbeb1a9240) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/09a14ae7-bd4a-415b-b22e-66bbeb1a9240) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)

## Builder security boundary (prototype)

The edge handler requires a server-verified, non-anonymous Supabase user with
`app_metadata.roles` containing `builder` or `app_metadata.builder_enabled=true`.
User-editable metadata never grants access. The current public demo client sends
a public key and is therefore intentionally rejected until a reviewed sign-in
flow supplies a user access token; this is not a working authenticated demo yet.

The local limiter is per isolate (10 requests/user/minute), not a distributed
billing quota. A deployment requires an owner-reviewed shared gateway quota and
provider budget controls. No deployment or production entitlement was changed.
Requests have body/model/message bounds; raw prompts, headers and upstream error
bodies are never logged. Copy `.env.example` locally; public client configuration
is not a privileged credential. Historical tracked configuration is unchanged.

Offline regression: `deno test supabase/functions/builder-chat/security_test.ts`.
No production credentials or outbound requests are required by these tests.
