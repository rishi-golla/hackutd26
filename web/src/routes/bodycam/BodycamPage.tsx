// Owned by the chest-camera lane (SPEC.md §0.2 Lanes). Still a placeholder for the camera, video and voice parts.
// CPR assistance (web/src/cpr/, hospital lane) is mounted here; the camera lane keeps <CprPanel /> on this page
// when it builds the rest (spec decision 18).
import CprPanel from '../../cpr/CprPanel';

export default function BodycamPage() {
  return (
    <main className="placeholder bodycam">
      <h1>Bodycam</h1>
      <CprPanel />
      <p className="muted">Camera, live video and the voice gate: camera lane (not built yet).</p>
    </main>
  );
}
