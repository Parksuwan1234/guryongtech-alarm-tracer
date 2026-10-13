import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-[50vh] place-items-center text-center">
      <div className="space-y-3">
        <h1 className="text-xl font-semibold text-slate-100">없는 화면입니다</h1>
        <p className="text-sm text-slate-400">주소가 바뀌었거나 잘못 입력됐습니다. 아래에서 처음 화면으로 돌아가세요.</p>
        <Link href="/" className="inline-block rounded-md bg-sky-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-800">
          실시간 현황으로 →
        </Link>
      </div>
    </div>
  );
}
