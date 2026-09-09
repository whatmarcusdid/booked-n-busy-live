import { Canvas, Storyboard } from "tempo-sdk/canvas";
import { FlowIntro } from "./Narration";
import { ScreenJobType } from "@/components/booking/screens";
import { ScreenJobDetails } from "@/components/booking/screens";
import { ScreenJobDetailsErrors } from "@/components/booking/screens";
import { ScreenPreferredTime } from "@/components/booking/screens";
import { ScreenPreferredTimeEmpty } from "@/components/booking/screens";
import { EmergencyCallout } from "./Narration";
import { ScreenEmergencyCall } from "@/components/booking/screens";
import { ScreenEmergencyRequested } from "@/components/booking/screens";
import { ScreenContact } from "@/components/booking/screens";
import { ScreenReview } from "@/components/booking/screens";
import { ScreenConfirmation } from "@/components/booking/screens";
import { ScreenConfirmationEmergency } from "@/components/booking/screens";

export default function BookingFlowCanvas() {
  return (
    <Canvas name="Booking Flow">
      {/* Intro — top-left */}
      <Storyboard
        id="Intro"
        name="How to read this"
        component={FlowIntro}
        layout={{ x: 0, y: 0, width: 520, height: 420, intrinsicSizing: "root-element" }}
      />

      {/* Happy path — one left-to-right row, steps 1 → 6 */}
      <Storyboard
        id="JobType"
        name="1 · Job type"
        component={ScreenJobType}
        layout={{ x: 0, y: 520, width: 600, height: 880, intrinsicSizing: "root-element" }}
      />
      <Storyboard
        id="JobDetails"
        name="2 · Job details"
        component={ScreenJobDetails}
        layout={{ x: 680, y: 520, width: 600, height: 940, intrinsicSizing: "root-element" }}
      />
      <Storyboard
        id="PreferredTime"
        name="3 · Preferred time"
        component={ScreenPreferredTime}
        layout={{ x: 1360, y: 520, width: 600, height: 820, intrinsicSizing: "root-element" }}
      />
      <Storyboard
        id="Contact"
        name={"4 · Contact & address"}
        component={ScreenContact}
        layout={{ x: 2040, y: 520, width: 600, height: 760, intrinsicSizing: "root-element" }}
      />
      <Storyboard
        id="Review"
        name={"5 · Review & confirm"}
        component={ScreenReview}
        layout={{ x: 2720, y: 520, width: 600, height: 760, intrinsicSizing: "root-element" }}
      />
      <Storyboard
        id="Confirmation"
        name="6 · Confirmation"
        component={ScreenConfirmation}
        layout={{ x: 3400, y: 520, width: 600, height: 720, intrinsicSizing: "root-element" }}
      />

      {/* Alternate states — stacked beneath their parent step */}
      <Storyboard
        id="JobDetailsErrors"
        name="2 · Job details — validation"
        component={ScreenJobDetailsErrors}
        layout={{ x: 680, y: 1560, width: 600, height: 940, intrinsicSizing: "root-element" }}
      />
      <Storyboard
        id="PreferredTimeEmpty"
        name="3 · No availability"
        component={ScreenPreferredTimeEmpty}
        layout={{ x: 1360, y: 1560, width: 600, height: 620, intrinsicSizing: "root-element" }}
      />
      <Storyboard
        id="ConfirmationEmergency"
        name="6 · Confirmation — emergency"
        component={ScreenConfirmationEmergency}
        layout={{ x: 3400, y: 1560, width: 600, height: 700, intrinsicSizing: "root-element" }}
      />

      {/* Emergency branch — diverges from step 2 */}
      <Storyboard
        id="EmergencyNote"
        name="Emergency branch"
        component={EmergencyCallout}
        layout={{ x: 680, y: 2620, width: 520, height: 300, intrinsicSizing: "root-element" }}
      />
      <Storyboard
        id="EmergencyCall"
        name="Emergency · Call now"
        component={ScreenEmergencyCall}
        layout={{ x: 680, y: 2980, width: 600, height: 860, intrinsicSizing: "root-element" }}
      />
      <Storyboard
        id="EmergencyRequested"
        name="Emergency · Call-back requested"
        component={ScreenEmergencyRequested}
        layout={{ x: 1360, y: 2980, width: 600, height: 560, intrinsicSizing: "root-element" }}
      />
    </Canvas>
  );
}
