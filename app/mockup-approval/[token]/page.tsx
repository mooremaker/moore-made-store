import { MockupApprovalPage } from "@/components/MockupApprovalPage";
export const metadata={robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{token:string}>}){const {token}=await params;return <MockupApprovalPage token={token}/>;}
