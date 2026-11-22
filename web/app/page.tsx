import { TeamView } from "@/components/TeamView";
import { getData } from "@/lib/data";

export default function Home() {
  const { meta, squad, players } = getData();
  return <TeamView squad={squad} players={players} meta={meta} />;
}
