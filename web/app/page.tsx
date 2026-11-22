import { TeamView } from "@/components/TeamView";
import { getData } from "@/lib/data";
import { configured } from "@/lib/alerts";

export default function Home() {
  const { meta, squad, players, others = [] } = getData();
  return <TeamView squad={squad} players={players} others={others} meta={meta} alerts={configured()} />;
}
