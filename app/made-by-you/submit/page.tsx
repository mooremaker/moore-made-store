import { ShowcaseSubmitForm } from "@/components/ShowcaseSubmitForm";

export default function ShareProjectPage() {
  return (
    <div className="shell showcaseSubmitPage">
      <section className="pageHero showcaseSubmitHero">
        <div className="eyebrow">Made by You</div>
        <h1>Show us how it turned out.</h1>
        <p className="lead">Share photos of your Moore Made order and leave a review. Every submission is reviewed before it appears publicly.</p>
      </section>
      <ShowcaseSubmitForm />
    </div>
  );
}
