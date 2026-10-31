export const metadata = { title: "Portal do condómino" };

export default function PortalLayout({ children }: LayoutProps<"/portal">) {
  return <div className="mx-auto flex w-full max-w-md flex-1 flex-col bg-stone-50">{children}</div>;
}
