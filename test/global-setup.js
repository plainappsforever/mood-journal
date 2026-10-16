// Every Jest run uses Europe/Berlin as the "device" zone (V1_PLAN P1), so any accidental use of the process zone is
// deterministic — and src/engine/zone-independence.test.ts proves the engines give the same answers in other zones.
module.exports = async () => {
  process.env.TZ = 'Europe/Berlin';
};
