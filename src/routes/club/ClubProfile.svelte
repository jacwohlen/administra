<script lang="ts">
  import MemberProfile from '$lib/components/memberProfile/MemberProfile.svelte';
  import type { MemberProfileData } from './memberProfile';

  // A member profile as members see it: read-only, contact data and
  // attendance only on their own profile (the database enforces the same).
  let { profile }: { profile: MemberProfileData } = $props();
</script>

<MemberProfile
  id={profile.member.id}
  firstname={profile.member.firstname}
  lastname={profile.member.lastname}
  photo={profile.photo}
  tags={profile.member.sections}
  isMine={profile.member.isMine}
  details={profile.details}
  detailsHint
  showAttendance={profile.member.isMine}
  achievements={profile}
/>
