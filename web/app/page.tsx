import { TeamView } from "@/components/TeamView";
import { getData } from "@/lib/data";
import { dateFr } from "@/lib/format";

export default function Home() {
  const { meta, squad, players } = getData();
  return <TeamView squad={squad} players={players} meta={meta} updated={dateFr(meta.generated_at)} />;
}
