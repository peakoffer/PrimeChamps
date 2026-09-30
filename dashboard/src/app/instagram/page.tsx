import UnifiedInbox from "@/components/channels/UnifiedInbox";
import { InstagramSending } from "./instagram-sending";

export default function InstagramPage() {
  return (
    <UnifiedInbox channel="instagram">
      <InstagramSending />
    </UnifiedInbox>
  );
}
