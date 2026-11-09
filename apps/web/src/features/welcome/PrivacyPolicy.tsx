import { Card, Logo } from '@alcove/ui';
import { Link } from '@tanstack/react-router';

export function PrivacyPolicy() {
  return (
    <main className="min-h-screen bg-ground px-5 py-10 sm:px-8 sm:py-16">
      <div className="mx-auto max-w-3xl">
        <header className="mb-7 space-y-5">
          <Link to="/" className="inline-flex rounded-md" aria-label="Alcove home"><Logo /></Link>
          <h1 className="font-display text-5xl text-ink">Privacy policy</h1>
          <p className="text-ink-2">How Alcove uses and stores your information when you sign in, make calls or connect a Google service.</p>
        </header>

        <Card label="How Alcove handles your information" className="space-y-7 p-5 leading-relaxed text-ink-2 sm:p-8">
          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-ink">Sign in with Google</h2>
            <p>Google gives Alcove an account identifier, your verified email address and, when available, your name and profile photo. Alcove uses them to create or find your account, show your profile and match you to invitations and shared items. Your profile and invitation details are visible to the people you interact with where those features show them. Alcove uses a session cookie to keep you signed in.</p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-ink">Google Calendar</h2>
            <p>When you connect Google Calendar, Alcove reads upcoming events, attendee responses and available busy times to show your schedule and help you find a time to meet. Availability checks send Google the email addresses and time range being checked. Alcove can create, update or cancel calendar events for calls you schedule with calendar syncing enabled. Google receives the event details, guests and join link, and sends invitations and updates to guests.</p>
            <p>Calendar results and busy times are read as needed. Alcove keeps the event reference for calls linked to Calendar. If you turn an existing Google event into an Alcove call, Alcove saves its title, time and guests as part of the call and adds the join link to the Google event.</p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-ink">Google Drive exports</h2>
            <p>When you connect Drive, Alcove receives the connected account details and permission to work with files it creates or that you give it access to. You choose a destination folder and which notes, transcripts or retained call audio to export. Alcove saves the account and folder details, your export choices and upload progress so it can finish exports in the background.</p>
            <p>Exports are readable copies. Google and anyone who can read the destination folder can read those files. Manage who can open or delete exported files in Google Drive.</p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-ink">Calls, recordings and shared content</h2>
            <p>Alcove processes the information you provide to host calls, store notes and recordings, and let you share documents or notes with people you choose. During calls with notes enabled, Alcove processes audio and transcripts to write the notes. Audio and transcript content needed for that feature is sent to NEAR AI for transcription and writing. People you invite or share with can see the information their access permits. If you connect an external agent, Alcove provides information to it according to the permissions you grant.</p>
            <p>Alcove uses infrastructure providers to deliver the service, including Google Cloud for hosting, Cloudflare for the website and object storage, and LiveKit for live calls. Alcove uses operational information such as request identifiers, timing, counts and error codes to keep the service running and investigate failures.</p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-ink">Storage and your controls</h2>
            <p>Alcove encrypts stored profile information, call content, recordings, notes and connected Google credentials. It keeps your profile for the life of your account. It keeps the credentials for a connected service until you disconnect it or delete your account, and uses them to carry out the tasks you enabled.</p>
            <p>Disconnect Calendar or Drive in Settings to remove the saved connection and stop future syncing or exports. You can also revoke access in your Google Account. Existing Drive exports stay in Drive until removed there.</p>
            <p>In Settings under Privacy, you can delete your account, end its sessions and remove the account data Alcove holds in its live systems. Content held by other participants and copies already shared or exported can remain. Backup copies may remain until the backups expire.</p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-ink">Google data use</h2>
            <p>Alcove’s use and transfer of information received from Google APIs follows the <a className="text-sun-text underline underline-offset-4" href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements.</p>
          </section>
        </Card>
      </div>
    </main>
  );
}
